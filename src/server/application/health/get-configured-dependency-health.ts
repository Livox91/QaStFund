import "server-only";

import { createPublicClient, http } from "viem";

import { validateEnvironment } from "@/infrastructure/config/environment";
import { prismaOperationalHealthRepository } from "@/infrastructure/database/repositories/prisma-operational-health-repository";
import {
  getOperationalSnapshot,
  evaluateOperationalThreshold,
  recordOperationalFailure,
  recordOperationalSuccess,
} from "@/infrastructure/observability/operational-signals";
import {
  arcTestnet,
  ARC_TESTNET_CHAIN_ID,
} from "@/integrations/arc/arc-testnet";
import { getConfiguredEscrowAddress } from "@/integrations/arc/employee-lending-escrow";
import { evaluateOperationalIncidents } from "@/modules/operations/application/evaluate-operational-incidents";
import { createOperationalIncidentSender } from "@/modules/operations/application/operational-incidents";
import { prismaOperationalIncidentRepository } from "@/modules/operations/infrastructure/prisma-operational-incident-repository";
import { buildDependencyHealth } from "@/server/application/health/build-dependency-health";

export async function getConfiguredDependencyHealth() {
  const environment = validateEnvironment();
  const now = new Date();
  const contractAddress = getConfiguredEscrowAddress();
  let arc: {
    status: "healthy" | "unhealthy";
    chainId?: number;
    contractConfigured: boolean;
  } = { status: "unhealthy", contractConfigured: Boolean(contractAddress) };
  let latestChainBlock: bigint | undefined;

  if (contractAddress) {
    try {
      const client = createPublicClient({
        chain: arcTestnet,
        transport: http(environment.ARC_RECONCILIATION_RPC_URL, {
          retryCount: 0,
          timeout: 5_000,
        }),
      });
      const [chainId, code, latestBlock] = await Promise.all([
        client.getChainId(),
        client.getCode({ address: contractAddress }),
        client.getBlockNumber(),
      ]);
      arc = {
        status:
          chainId === ARC_TESTNET_CHAIN_ID && code && code !== "0x"
            ? "healthy"
            : "unhealthy",
        chainId,
        contractConfigured: code !== undefined && code !== "0x",
      };
      latestChainBlock = latestBlock;
      if (arc.status === "healthy") recordOperationalSuccess("arc_rpc", now);
      else {
        recordOperationalFailure("arc_rpc", {
          alertThreshold: environment.OBSERVABILITY_FAILURE_ALERT_THRESHOLD,
          occurredAt: now,
        });
      }
    } catch {
      recordOperationalFailure("arc_rpc", {
        alertThreshold: environment.OBSERVABILITY_FAILURE_ALERT_THRESHOLD,
        occurredAt: now,
      });
    }
  }

  const [
    reconciliationResult,
    erpResult,
    transactionResult,
    jobsResult,
    incidentResult,
  ] = await Promise.allSettled([
    contractAddress
      ? prismaOperationalHealthRepository.getReconciliationState(
          ARC_TESTNET_CHAIN_ID,
          contractAddress,
        )
      : Promise.resolve(null),
    environment.ERP_NEXT_SYNC_ENABLED
      ? prismaOperationalHealthRepository.getErpNextState(
          new Date(
            now.getTime() -
              environment.ERP_NEXT_SYNC_STALE_AFTER_MINUTES * 60_000,
          ),
        )
      : Promise.resolve(null),
    prismaOperationalHealthRepository.getTransactionState({
      now,
      staleBefore: new Date(
        now.getTime() -
          environment.OBSERVABILITY_TRANSACTION_STALE_AFTER_MINUTES * 60_000,
      ),
    }),
    prismaOperationalHealthRepository.getOperationalJobs(),
    prismaOperationalHealthRepository.getIncidentDeliveryState(),
  ]);
  const snapshot = getOperationalSnapshot();
  const reconciliationState =
    reconciliationResult.status === "fulfilled"
      ? reconciliationResult.value
      : null;
  const persistentCursor = reconciliationState?.cursor;
  const failures = {
    ...snapshot.failures,
    ...(persistentCursor
      ? {
          reconciliation: {
            consecutiveFailures: Math.max(
              snapshot.failures.reconciliation?.consecutiveFailures ?? 0,
              persistentCursor.consecutiveFailures,
            ),
            lastFailureAt:
              snapshot.failures.reconciliation?.lastFailureAt ??
              persistentCursor.lastFailureAt?.toISOString() ??
              null,
            lastSuccessAt:
              snapshot.failures.reconciliation?.lastSuccessAt ??
              persistentCursor.lastSuccessfulAt?.toISOString() ??
              null,
          },
        }
      : {}),
  };

  const report = buildDependencyHealth({
    now,
    reconciliationEnabled: environment.ARC_RECONCILIATION_ENABLED,
    reconciliationStaleAfterMs:
      environment.ARC_RECONCILIATION_STALE_AFTER_MINUTES * 60_000,
    reconciliationConfirmationDepth:
      environment.ARC_RECONCILIATION_CONFIRMATIONS,
    reconciliationHealthWindowBlocks:
      environment.ARC_RECONCILIATION_BLOCK_RANGE,
    reconciliationMaxRangesPerRun: environment.ARC_RECONCILIATION_MAX_RANGES,
    latestChainBlock,
    reconciliationState,
    latestObservedBlock:
      snapshot.reconciliation.latestObservedBlock ??
      persistentCursor?.latestObservedBlock?.toString() ??
      null,
    failures,
    arc,
    circleConfigured: Boolean(
      process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY &&
      process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL,
    ),
    erpEnabled: environment.ERP_NEXT_SYNC_ENABLED,
    erpState: erpResult.status === "fulfilled" ? erpResult.value : null,
    transactionState:
      transactionResult.status === "fulfilled" ? transactionResult.value : null,
    operationalJobs: jobsResult.status === "fulfilled" ? jobsResult.value : [],
    expectedJobs: [
      ...(environment.ARC_RECONCILIATION_ENABLED
        ? [
            {
              jobKey: "arc-reconciliation",
              subsystem: "reconciliation",
              intervalSeconds: environment.ARC_RECONCILIATION_INTERVAL_SECONDS,
            },
          ]
        : []),
      ...(environment.ERP_NEXT_SYNC_ENABLED
        ? [
            {
              jobKey: "erpnext-sync",
              subsystem: "erpnext",
              intervalSeconds: environment.ERP_NEXT_SYNC_INTERVAL_MINUTES * 60,
            },
          ]
        : []),
    ],
    schedulerGraceMs: environment.OBSERVABILITY_SCHEDULER_GRACE_SECONDS * 1_000,
    incidentDeliveryState:
      incidentResult.status === "fulfilled" ? incidentResult.value : null,
    metrics: snapshot.counters,
    timers: snapshot.timers,
  });
  if (reconciliationState) {
    evaluateOperationalThreshold(
      "unmatched_blockchain_events",
      reconciliationState.unmatchedEvents,
      environment.OBSERVABILITY_UNMATCHED_EVENT_ALERT_THRESHOLD,
      { chainId: ARC_TESTNET_CHAIN_ID },
    );
  }
  if (report.dependencies.reconciliation.status === "stale") {
    recordOperationalFailure("reconciliation", {
      alertThreshold: environment.OBSERVABILITY_FAILURE_ALERT_THRESHOLD,
      context: { reason: "stale" },
      occurredAt: now,
    });
  } else if (report.dependencies.reconciliation.status === "healthy") {
    recordOperationalSuccess("reconciliation", now);
  }
  await evaluateOperationalIncidents({
    report,
    failureThreshold: environment.OBSERVABILITY_FAILURE_ALERT_THRESHOLD,
    unmatchedEventThreshold:
      environment.OBSERVABILITY_UNMATCHED_EVENT_ALERT_THRESHOLD,
    retryAfterMs: environment.OBSERVABILITY_ALERT_RETRY_MINUTES * 60_000,
    now,
    repository: prismaOperationalIncidentRepository,
    sender: createOperationalIncidentSender({
      webhookUrl: environment.OPERATIONAL_ALERT_WEBHOOK_URL,
      bearerToken: environment.OPERATIONAL_ALERT_WEBHOOK_BEARER_TOKEN,
    }),
  });
  return report;
}
