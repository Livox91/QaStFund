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
  reconciliationConfirmationDepth?: number;
  reconciliationHealthWindowBlocks?: number;
  reconciliationMaxRangesPerRun?: number;
  latestChainBlock?: bigint | null;
  reconciliationState: {
    cursor: {
      nextBlock: bigint;
      finalizedThrough: bigint;
      updatedAt: Date;
      alertState?: "HEALTHY" | "STALE" | "FAILING";
      alertChangedAt?: Date;
      alertDeliveryPending?: boolean;
      lastAlertAttemptAt?: Date | null;
      lastAlertDeliveredAt?: Date | null;
      lastAlertFailedAt?: Date | null;
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
    connectedIntegrations: number;
    incompleteIntegrations: number;
    staleIntegrations: number;
    unresolvedEmployeeRecords?: number;
    lastAttemptedAt?: Date | null;
    lastCompletedAt?: Date | null;
    lastResult?: string | null;
    lastCorrelationId?: string | null;
    lastSafeErrorCode?: string | null;
    lastSuccessfulAt?: Date | null;
  } | null;
  pendingTransactionCount?: number | null;
  transactionState?: {
    pendingSubmission: number;
    pendingConfirmation: number;
    pendingReconciliation: number;
    ambiguousOutcomes: number;
    failedOperations: number;
    failedRepayments: number;
    overdueRepayments: number;
  } | null;
  operationalJobs?: ReadonlyArray<{
    jobKey: string;
    subsystem: string;
    intervalSeconds: number;
    lastAttemptedAt: Date | null;
    lastSucceededAt: Date | null;
    lastFailedAt: Date | null;
    nextExpectedAt: Date | null;
    consecutiveFailures: number;
    lastSafeErrorCode: string | null;
  }>;
  expectedJobs?: ReadonlyArray<{
    jobKey: string;
    subsystem: string;
    intervalSeconds: number;
  }>;
  schedulerGraceMs?: number;
  incidentDeliveryState?: {
    activeIncidents: number;
    pendingDeliveries: number;
    failedDeliveries: number;
  } | null;
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
        latestChainBlock: input.latestChainBlock,
        confirmationDepth: input.reconciliationConfirmationDepth,
        healthWindowBlocks: input.reconciliationHealthWindowBlocks,
        maxRangesPerRun: input.reconciliationMaxRangesPerRun,
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
            input.erpState.incompleteIntegrations > 0 ||
            input.erpState.staleIntegrations > 0 ||
            (erpFailure?.consecutiveFailures ?? 0) > 0
              ? ("unhealthy" as const)
              : ("healthy" as const),
          enabled: true,
          ...input.erpState,
          lastAttemptedAt:
            input.erpState.lastAttemptedAt?.toISOString() ?? null,
          lastCompletedAt:
            input.erpState.lastCompletedAt?.toISOString() ?? null,
          lastSuccessfulAt:
            input.erpState.lastSuccessfulAt?.toISOString() ?? null,
          consecutiveFailures: erpFailure?.consecutiveFailures ?? 0,
        }
      : { ...safeDependencyFailure(), enabled: true };

  const persistedJobs = input.operationalJobs ?? [];
  const jobs = persistedJobs.map((job) => {
    const missed =
      job.nextExpectedAt !== null &&
      input.now.getTime() >
        job.nextExpectedAt.getTime() + (input.schedulerGraceMs ?? 60_000);
    return {
      jobKey: job.jobKey,
      subsystem: job.subsystem,
      status:
        missed || job.consecutiveFailures > 0
          ? ("unhealthy" as const)
          : ("healthy" as const),
      missed,
      intervalSeconds: job.intervalSeconds,
      lastAttemptedAt: job.lastAttemptedAt?.toISOString() ?? null,
      lastSucceededAt: job.lastSucceededAt?.toISOString() ?? null,
      lastFailedAt: job.lastFailedAt?.toISOString() ?? null,
      nextExpectedAt: job.nextExpectedAt?.toISOString() ?? null,
      consecutiveFailures: job.consecutiveFailures,
      lastSafeErrorCode: job.lastSafeErrorCode,
    };
  });
  for (const expected of input.expectedJobs ?? []) {
    if (jobs.some((job) => job.jobKey === expected.jobKey)) continue;
    jobs.push({
      ...expected,
      status: "unhealthy" as const,
      missed: true,
      lastAttemptedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      nextExpectedAt: null,
      consecutiveFailures: 0,
      lastSafeErrorCode: "JOB_HAS_NOT_REPORTED",
    });
  }
  const transactionState = input.transactionState ?? null;
  const operationallyUnhealthy =
    jobs.some((job) => job.status === "unhealthy") ||
    (transactionState?.ambiguousOutcomes ?? 0) > 0 ||
    (transactionState?.failedOperations ?? 0) > 0 ||
    (input.incidentDeliveryState?.failedDeliveries ?? 0) > 0;

  return {
    status:
      input.arc.status === "healthy" &&
      reconciliation.status !== "unhealthy" &&
      reconciliation.status !== "stale" &&
      erpnext.status !== "unhealthy" &&
      !operationallyUnhealthy
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
      pendingTransactionCount:
        input.pendingTransactionCount ??
        (transactionState
          ? transactionState.pendingSubmission +
            transactionState.pendingConfirmation +
            transactionState.pendingReconciliation
          : null),
    },
    transactions: transactionState,
    repayments: {
      overdue: transactionState?.overdueRepayments ?? null,
      failedProcessing: transactionState?.failedRepayments ?? null,
    },
    jobs,
    incidents: input.incidentDeliveryState ?? null,
  };
}
