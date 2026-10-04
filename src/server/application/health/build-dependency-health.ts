import type { DependencyStatus } from "@/server/domain/health/health-status";
import {
  evaluateReconciliationHealth,
  safeDependencyFailure,
} from "@/server/application/health/get-dependency-health";

type FailureSnapshot = Readonly<{
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
}>;

type DependencyHealthInput = Readonly<{
  now: Date;
  reconciliationEnabled: boolean;
  reconciliationStaleAfterMs: number;
  reconciliationState: {
    cursor: {
      nextBlock: bigint;
      finalizedThrough: bigint;
      updatedAt: Date;
    } | null;
    unmatchedEvents: number;
    conflictingEvents: number;
  } | null;
  latestObservedBlock: string | null;
  failures: Partial<
    Record<"arc_rpc" | "circle" | "erpnext" | "reconciliation", FailureSnapshot>
  >;
  arc: {
    status: DependencyStatus;
    chainId?: number;
    contractConfigured: boolean;
  };
  circleConfigured: boolean;
  erpEnabled: boolean;
  erpState: {
    configuredIntegrations: number;
    failedIntegrations: number;
  } | null;
  pendingTransactionCount: number | null;
  metrics: Record<string, number>;
  timers: Record<string, { count: number; totalMs: number; maxMs: number }>;
}>;

export function buildDependencyHealth(input: DependencyHealthInput) {
  const reconciliationFailure = input.failures.reconciliation;
  const reconciliation = input.reconciliationState
    ? evaluateReconciliationHealth({
        enabled: input.reconciliationEnabled,
        cursor: input.reconciliationState.cursor,
        latestObservedBlock: input.latestObservedBlock,
        lastSuccessfulAt: reconciliationFailure?.lastSuccessAt ?? null,
        failureCount: reconciliationFailure?.consecutiveFailures ?? 0,
        unmatchedEvents: input.reconciliationState.unmatchedEvents,
        conflictingEvents: input.reconciliationState.conflictingEvents,
        staleAfterMs: input.reconciliationStaleAfterMs,
        now: input.now,
      })
    : input.reconciliationEnabled
      ? safeDependencyFailure()
      : { status: "disabled" as const, enabled: false };

  const circleFailure = input.failures.circle;
  const circle = !input.circleConfigured
    ? { status: "disabled" as const, configured: false }
    : {
        status:
          (circleFailure?.consecutiveFailures ?? 0) > 0
            ? ("unhealthy" as const)
            : ("healthy" as const),
        configured: true,
        consecutiveFailures: circleFailure?.consecutiveFailures ?? 0,
        lastFailureAt: circleFailure?.lastFailureAt ?? null,
        lastSuccessAt: circleFailure?.lastSuccessAt ?? null,
      };

  const erpFailure = input.failures.erpnext;
  const erpnext = !input.erpEnabled
    ? { status: "disabled" as const, enabled: false }
    : input.erpState
      ? {
          status:
            input.erpState.failedIntegrations > 0 ||
            (erpFailure?.consecutiveFailures ?? 0) > 0
              ? ("unhealthy" as const)
              : ("healthy" as const),
          enabled: true,
          ...input.erpState,
          consecutiveFailures: erpFailure?.consecutiveFailures ?? 0,
        }
      : { ...safeDependencyFailure(), enabled: true };

  return {
    status:
      input.arc.status === "healthy" &&
      reconciliation.status !== "unhealthy" &&
      reconciliation.status !== "stale" &&
      erpnext.status !== "unhealthy"
        ? ("healthy" as const)
        : ("degraded" as const),
    checkedAt: input.now.toISOString(),
    dependencies: {
      arc: input.arc,
      circle,
      erpnext,
      reconciliation,
    },
    metrics: {
      counters: input.metrics,
      timers: input.timers,
      pendingTransactionCount: input.pendingTransactionCount,
    },
  };
}
