import type { DependencyStatus } from "@/server/domain/health/health-status";

export type ReconciliationHealthInput = Readonly<{
  enabled: boolean;
  cursor: {
    nextBlock: bigint;
    finalizedThrough: bigint;
    updatedAt: Date;
    lastSuccessfulAt?: Date | null;
  } | null;
  latestObservedBlock: string | null;
  lastSuccessfulAt: string | null;
  failureCount: number;
  unmatchedEvents: number;
  conflictingEvents: number;
  staleAfterMs: number;
  now: Date;
}>;

export function evaluateReconciliationHealth(input: ReconciliationHealthInput) {
  if (!input.enabled) {
    return { status: "disabled" as const, enabled: false };
  }
  const lastSuccessfulAt = input.lastSuccessfulAt
    ? new Date(input.lastSuccessfulAt)
    : (input.cursor?.lastSuccessfulAt ?? null);
  const stale =
    lastSuccessfulAt === null ||
    input.now.getTime() - lastSuccessfulAt.getTime() > input.staleAfterMs;
  const status: DependencyStatus = stale ? "stale" : "healthy";
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
  };
}

export function safeDependencyFailure(status: DependencyStatus = "unhealthy") {
  return { status, error: "Dependency check failed" } as const;
}
