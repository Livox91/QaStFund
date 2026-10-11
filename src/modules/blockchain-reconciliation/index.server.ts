import "server-only";

import { validateEnvironment } from "@/infrastructure/config/environment";
import { prisma } from "@/infrastructure/database/prisma";
import { ARC_TESTNET_CHAIN_ID } from "@/integrations/arc/arc-testnet";
import { getConfiguredEscrowAddress } from "@/integrations/arc/employee-lending-escrow";
import { reconcileBlockchainEvents } from "@/modules/blockchain-reconciliation/application/reconcile-blockchain-events";
import {
  createOperationalAlertSender,
  transitionReconciliationAlert,
} from "@/modules/blockchain-reconciliation/application/reconciliation-alerts";
import { prismaReconciliationAlertRepository } from "@/modules/blockchain-reconciliation/infrastructure/prisma-reconciliation-alert-repository";
import { prismaReconciliationRepository } from "@/modules/blockchain-reconciliation/infrastructure/prisma-reconciliation-repository";
import { createViemArcEventSource } from "@/modules/blockchain-reconciliation/infrastructure/viem-arc-event-source";

export async function runConfiguredArcReconciliation() {
  const environment = validateEnvironment();
  if (!environment.ARC_RECONCILIATION_ENABLED) {
    throw new Error("Arc reconciliation is disabled");
  }
  const contractAddress = getConfiguredEscrowAddress();
  if (!contractAddress) {
    throw new Error("Arc lending contract address is not configured");
  }
  return reconcileBlockchainEvents(
    {
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: contractAddress.toLowerCase(),
      startBlock: environment.ARC_RECONCILIATION_START_BLOCK,
      confirmationDepth: environment.ARC_RECONCILIATION_CONFIRMATIONS,
      blockRange: environment.ARC_RECONCILIATION_BLOCK_RANGE,
      reorgWindow: environment.ARC_RECONCILIATION_REORG_WINDOW,
      maxRangesPerRun: environment.ARC_RECONCILIATION_MAX_RANGES,
      eventBatchSize: 500,
      rpcMaxRetries: environment.ARC_RECONCILIATION_RPC_RETRIES,
      retryBaseDelayMs: 250,
      leaseDurationMs: 5 * 60_000,
      staleAfterMs: environment.ARC_RECONCILIATION_STALE_AFTER_MINUTES * 60_000,
      failureAlertThreshold: environment.OBSERVABILITY_FAILURE_ALERT_THRESHOLD,
      unmatchedEventAlertThreshold:
        environment.OBSERVABILITY_UNMATCHED_EVENT_ALERT_THRESHOLD,
    },
    prismaReconciliationRepository,
    createViemArcEventSource({
      contractAddress,
      rpcUrl: environment.ARC_RECONCILIATION_RPC_URL,
    }),
  );
}

export async function runScheduledArcReconciliation() {
  const environment = validateEnvironment();
  const contractAddress = getConfiguredEscrowAddress();
  if (!contractAddress) {
    throw new Error("Arc lending contract address is not configured");
  }
  const normalizedContract = contractAddress.toLowerCase();
  const sender = createOperationalAlertSender({
    webhookUrl: environment.OPERATIONAL_ALERT_WEBHOOK_URL,
    bearerToken: environment.OPERATIONAL_ALERT_WEBHOOK_BEARER_TOKEN,
  });
  const transition = (
    targetState: "HEALTHY" | "STALE" | "FAILING",
    detail: string,
    context?: Record<string, string | number | boolean | null>,
  ) =>
    transitionReconciliationAlert({
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: normalizedContract,
      targetState,
      detail,
      context,
      repository: prismaReconciliationAlertRepository,
      sender,
    });

  try {
    const result = await runConfiguredArcReconciliation();
    if (result.status === "SKIPPED_CONCURRENT") {
      return { ...result, alerts: [] };
    }

    const alerts = [];
    if (result.startedStale) {
      const staleAlert = await transition(
        "STALE",
        "Arc reconciliation started outside its configured freshness window.",
        {
          startedBacklogBlocks: result.startedBacklogBlocks,
          remainingBacklogBlocks: result.remainingBacklogBlocks,
          maxBlocksPerRun: result.maxBlocksPerRun,
        },
      );
      alerts.push(staleAlert);
      if (!staleAlert.delivered) return { ...result, alerts };
    }

    const remainingBacklog = BigInt(result.remainingBacklogBlocks);
    const targetState =
      remainingBacklog > BigInt(environment.ARC_RECONCILIATION_BLOCK_RANGE)
        ? "STALE"
        : "HEALTHY";
    alerts.push(
      await transition(
        targetState,
        targetState === "HEALTHY"
          ? "Arc reconciliation is within its finalized-head freshness window."
          : "Arc reconciliation remains behind after a bounded catch-up pass.",
        {
          remainingBacklogBlocks: result.remainingBacklogBlocks,
          cursorNextBlock: result.cursorNextBlock,
          finalizedThrough: result.finalizedThrough,
          caughtUp: result.caughtUp,
        },
      ),
    );
    return { ...result, alerts };
  } catch (error) {
    const cursor = await prisma.blockchainReconciliationCursor.findUnique({
      where: {
        chainId_contractAddress: {
          chainId: ARC_TESTNET_CHAIN_ID,
          contractAddress: normalizedContract,
        },
      },
      select: { consecutiveFailures: true },
    });
    if (
      cursor &&
      cursor.consecutiveFailures >=
        environment.OBSERVABILITY_FAILURE_ALERT_THRESHOLD
    ) {
      await transition(
        "FAILING",
        "Arc reconciliation repeatedly failed and requires operator action.",
        { consecutiveFailures: cursor.consecutiveFailures },
      );
    }
    throw error;
  }
}
