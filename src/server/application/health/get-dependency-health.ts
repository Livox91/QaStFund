import type { DependencyStatus } from "@/server/domain/health/health-status";
import { reconciliationProgress } from "@/modules/blockchain-reconciliation/domain/reconciliation-progress";

export type ReconciliationHealthInput = Readonly<{
  enabled: boolean;
  cursor: {
    nextBlock: bigint;
    finalizedThrough: bigint;
    updatedAt: Date;
    lastSuccessfulAt?: Date | null;
    alertState?: "HEALTHY" | "STALE" | "FAILING";
    alertChangedAt?: Date;
    alertDeliveryPending?: boolean;
    lastAlertAttemptAt?: Date | null;
    lastAlertDeliveredAt?: Date | null;
    lastAlertFailedAt?: Date | null;
  } | null;
  latestObservedBlock: string | null;
  lastSuccessfulAt: string | null;
  failureCount: number;
  unmatchedEvents: number;
  conflictingEvents: number;
  staleAfterMs: number;
  latestChainBlock?: bigint | null;
  confirmationDepth?: number;
  healthWindowBlocks?: number;
  maxRangesPerRun?: number;
  now: Date;
}>;

export function evaluateReconciliationHealth(input: ReconciliationHealthInput) {
  if (!input.enabled) {
    return { status: "disabled" as const, enabled: false };
  }
  const lastSuccessfulAt = input.lastSuccessfulAt
    ? new Date(input.lastSuccessfulAt)
    : (input.cursor?.lastSuccessfulAt ?? null);
  const timeStale =
    lastSuccessfulAt === null ||
    input.now.getTime() - lastSuccessfulAt.getTime() > input.staleAfterMs;
  const progress =
    input.cursor &&
    input.latestChainBlock !== null &&
    input.latestChainBlock !== undefined
      ? reconciliationProgress({
          cursorNextBlock: input.cursor.nextBlock,
          latestBlock: input.latestChainBlock,
          confirmationDepth: input.confirmationDepth ?? 0,
          blockRange: input.healthWindowBlocks ?? Number.MAX_SAFE_INTEGER,
          maxRangesPerRun: input.maxRangesPerRun ?? 1,
        })
      : null;
  const stale = timeStale || (progress?.stale ?? false);
  const status: DependencyStatus =
    input.failureCount > 0 || input.conflictingEvents > 0
      ? "unhealthy"
      : stale
        ? "stale"
        : "healthy";
  return {
    status,
    enabled: true,
    latestObservedBlock: input.latestObservedBlock,
    reconciliationCursor: input.cursor?.nextBlock.toString() ?? null,
    lastSuccessfullyReconciledBlock:
      input.cursor?.finalizedThrough.toString() ?? null,
    lastSuccessfulReconciliationAt: lastSuccessfulAt?.toISOString() ?? null,
    secondsSinceLastSuccessfulReconciliation: lastSuccessfulAt
      ? Math.max(
          0,
          Math.floor(
            (input.now.getTime() - lastSuccessfulAt.getTime()) / 1_000,
          ),
        )
      : null,
    reconciliationFailures: input.failureCount,
    unmatchedEvents: input.unmatchedEvents,
    conflictingEvents: input.conflictingEvents,
    finalizedChainHead: progress?.finalizedThrough.toString() ?? null,
    backlogBlocks: progress?.backlogBlocks.toString() ?? null,
    healthWindowBlocks: progress?.healthWindowBlocks.toString() ?? null,
    maxBlocksPerRun: progress?.maxBlocksPerRun.toString() ?? null,
    caughtUp: progress?.caughtUp ?? null,
    alertState: input.cursor?.alertState ?? null,
    alertChangedAt: input.cursor?.alertChangedAt?.toISOString() ?? null,
    alertDeliveryPending: input.cursor?.alertDeliveryPending ?? null,
    lastAlertAttemptAt: input.cursor?.lastAlertAttemptAt?.toISOString() ?? null,
    lastAlertDeliveredAt:
      input.cursor?.lastAlertDeliveredAt?.toISOString() ?? null,
    lastAlertFailedAt: input.cursor?.lastAlertFailedAt?.toISOString() ?? null,
  };
}

export function safeDependencyFailure(status: DependencyStatus = "unhealthy") {
  return { status, error: "Dependency check failed" } as const;
}
