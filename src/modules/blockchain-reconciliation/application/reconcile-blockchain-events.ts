import { randomUUID } from "node:crypto";

import { logger } from "@/infrastructure/logging/logger";
import {
  incrementOperationalCounter,
  logTransactionLifecycle,
  recordOperationalFailure,
  recordOperationalSuccess,
  recordReconciliationFailure,
  recordReconciliationSuccess,
} from "@/infrastructure/observability/operational-signals";
import type {
  ReconciliationEventSource,
  ReconciliationRepository,
} from "@/modules/blockchain-reconciliation/application/ports";

export type ReconciliationConfig = Readonly<{
  chainId: number;
  contractAddress: string;
  startBlock: bigint;
  confirmationDepth: number;
  blockRange: number;
  reorgWindow: number;
  maxRangesPerRun: number;
  eventBatchSize: number;
  rpcMaxRetries: number;
  retryBaseDelayMs: number;
  leaseDurationMs: number;
  failureAlertThreshold?: number;
  unmatchedEventAlertThreshold?: number;
}>;

type Clock = Readonly<{
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
}>;

const systemClock: Clock = {
  now: () => new Date(),
  sleep: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

async function retryRpc<T>(
  operation: string,
  attempts: number,
  baseDelayMs: number,
  alertThreshold: number,
  clock: Clock,
  run: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      incrementOperationalCounter("blockchain_rpc_failures_total");
      recordOperationalFailure("arc_rpc", {
        alertThreshold,
        context: { operation },
        occurredAt: clock.now(),
      });
      logger.warn("Arc reconciliation RPC attempt failed", {
        operation,
        attempt,
        attempts,
      });
      if (attempt < attempts) {
        await clock.sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}

export async function reconcileBlockchainEvents(
  config: ReconciliationConfig,
  repository: ReconciliationRepository,
  source: ReconciliationEventSource,
  clock: Clock = systemClock,
) {
  const actualChainId = await retryRpc(
    "get-chain-id",
    config.rpcMaxRetries,
    config.retryBaseDelayMs,
    config.failureAlertThreshold ?? 3,
    clock,
    () => source.getChainId(),
  );
  if (actualChainId !== config.chainId) {
    throw new Error(
      `Arc reconciliation chain mismatch: expected ${config.chainId}, received ${actualChainId}`,
    );
  }
  recordOperationalSuccess("arc_rpc", clock.now());

  const leaseOwner = randomUUID();
  const lease = await repository.acquireLease({
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    leaseOwner,
    leaseExpiresAt: new Date(clock.now().getTime() + config.leaseDurationMs),
    now: clock.now(),
    startBlock: config.startBlock,
  });
  if (!lease) {
    logger.info(
      "Arc reconciliation skipped because another worker owns the lease",
      {
        chainId: config.chainId,
        contractAddress: config.contractAddress,
      },
    );
    return { status: "SKIPPED_CONCURRENT" as const, scannedRanges: 0 };
  }

  let scannedRanges = 0;
  let observedEvents = 0;
  let appliedEvents = 0;
  let unmatchedEvents = 0;
  let conflictEvents = 0;
  try {
    const latestBlock = await retryRpc(
      "get-latest-block",
      config.rpcMaxRetries,
      config.retryBaseDelayMs,
      config.failureAlertThreshold ?? 3,
      clock,
      () => source.getLatestBlockNumber(),
    );
    recordOperationalSuccess("arc_rpc", clock.now());
    const confirmationDepth = BigInt(config.confirmationDepth);
    const finalizedThrough =
      latestBlock > confirmationDepth ? latestBlock - confirmationDepth : 0n;
    const rewindFrom =
      lease.nextBlock > BigInt(config.reorgWindow)
        ? lease.nextBlock - BigInt(config.reorgWindow)
        : config.startBlock;
    let fromBlock =
      rewindFrom > config.startBlock ? rewindFrom : config.startBlock;

    while (fromBlock <= latestBlock && scannedRanges < config.maxRangesPerRun) {
      const candidateTo = fromBlock + BigInt(config.blockRange - 1);
      const toBlock = candidateTo < latestBlock ? candidateTo : latestBlock;
      const events = await retryRpc(
        "get-events",
        config.rpcMaxRetries,
        config.retryBaseDelayMs,
        config.failureAlertThreshold ?? 3,
        clock,
        () => source.getEvents(fromBlock, toBlock),
      );
      const now = clock.now();
      await repository.recordRange({
        chainId: config.chainId,
        contractAddress: config.contractAddress,
        events,
        finalizedThrough,
        fromBlock,
        leaseOwner,
        now,
        toBlock,
      });
      scannedRanges += 1;
      observedEvents += events.length;
      logger.info("Arc reconciliation scanned block range", {
        fromBlock: fromBlock.toString(),
        toBlock: toBlock.toString(),
        finalizedThrough: finalizedThrough.toString(),
        eventCount: events.length,
      });
      const renewed = await repository.renewLease({
        chainId: config.chainId,
        contractAddress: config.contractAddress,
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + config.leaseDurationMs),
      });
      if (!renewed) throw new Error("Arc reconciliation lease was lost");
      fromBlock = toBlock + 1n;
    }

    const ready = await repository.listReadyEvents({
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      limit: config.eventBatchSize,
    });
    for (const event of ready) {
      const verified = await retryRpc(
        `verify-${event.name.toLowerCase()}`,
        config.rpcMaxRetries,
        config.retryBaseDelayMs,
        config.failureAlertThreshold ?? 3,
        clock,
        () => source.verifyEvent(event),
      );
      if (!verified) {
        await repository.flagConflict(
          event.id,
          "CHAIN_STATE_MISMATCH",
          "The finalized event does not match current escrow state.",
          clock.now(),
        );
        conflictEvents += 1;
        continue;
      }
      const result = await repository.applyEvent(event, clock.now());
      if (result.kind === "APPLIED") appliedEvents += 1;
      if (result.kind === "UNMATCHED") unmatchedEvents += 1;
      if (result.kind === "CONFLICT") conflictEvents += 1;
      if (result.kind === "APPLIED") {
        logTransactionLifecycle("missed_confirmation_recovered", {
          operationId: event.id,
          transactionHash: event.transactionHash,
          chainId: config.chainId,
          contractAddress: config.contractAddress,
        });
      } else if (result.kind === "UNMATCHED") {
        incrementOperationalCounter("unmatched_blockchain_events_total");
        logTransactionLifecycle("unmatched_blockchain_event", {
          operationId: event.id,
          transactionHash: event.transactionHash,
          chainId: config.chainId,
          contractAddress: config.contractAddress,
        });
      }
      logger.info("Arc reconciliation processed event", {
        eventId: event.id,
        eventName: event.name,
        result: result.kind,
        transactionHash: event.transactionHash,
      });
    }

    recordReconciliationSuccess({
      latestObservedBlock: latestBlock,
      occurredAt: clock.now(),
    });
    await repository.recordRunSuccess?.({
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      latestObservedBlock: latestBlock,
      occurredAt: clock.now(),
    });
    if (unmatchedEvents >= (config.unmatchedEventAlertThreshold ?? 10)) {
      logger.warn("Operational alert triggered", {
        alert: "unmatched_blockchain_events",
        unmatchedEvents,
        threshold: config.unmatchedEventAlertThreshold ?? 10,
        chainId: config.chainId,
        contractAddress: config.contractAddress,
      });
    }
    return {
      status: "COMPLETED" as const,
      scannedRanges,
      observedEvents,
      appliedEvents,
      unmatchedEvents,
      conflictEvents,
    };
  } catch (error) {
    incrementOperationalCounter("reconciliation_failures_total");
    recordReconciliationFailure(clock.now());
    recordOperationalFailure("reconciliation", {
      alertThreshold: config.failureAlertThreshold ?? 3,
      context: {
        chainId: config.chainId,
        contractAddress: config.contractAddress,
      },
      occurredAt: clock.now(),
    });
    await repository.recordRunFailure?.({
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      occurredAt: clock.now(),
    });
    logger.error("Arc reconciliation failed", error, {
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      scannedRanges,
      observedEvents,
    });
    throw error;
  } finally {
    await repository.releaseLease({
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      leaseOwner,
    });
  }
}
