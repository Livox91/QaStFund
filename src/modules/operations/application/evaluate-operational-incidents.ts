import type { buildDependencyHealth } from "@/server/application/health/build-dependency-health";
import {
  transitionOperationalIncident,
  type OperationalIncidentDefinition,
  type OperationalIncidentRepository,
  type OperationalIncidentSender,
} from "@/modules/operations/application/operational-incidents";

type OperationalHealthReport = ReturnType<typeof buildDependencyHealth>;

export function deriveOperationalIncidentChecks(input: {
  report: OperationalHealthReport;
  failureThreshold: number;
  unmatchedEventThreshold: number;
}): ReadonlyArray<{
  active: boolean;
  definition: OperationalIncidentDefinition;
}> {
  const { report } = input;
  const reconciliation = report.dependencies.reconciliation;
  const erpnext = report.dependencies.erpnext;
  const transactions = report.transactions;
  const reconciliationFailures =
    "reconciliationFailures" in reconciliation
      ? (reconciliation.reconciliationFailures ?? 0)
      : 0;
  const unmatchedEvents =
    "unmatchedEvents" in reconciliation
      ? (reconciliation.unmatchedEvents ?? 0)
      : 0;
  const conflictingEvents =
    "conflictingEvents" in reconciliation
      ? (reconciliation.conflictingEvents ?? 0)
      : 0;
  const checks: Array<{
    active: boolean;
    definition: OperationalIncidentDefinition;
  }> = [
    {
      active: erpnext.status === "unhealthy",
      definition: {
        deduplicationKey: "erpnext:sync-health",
        subsystem: "erpnext",
        kind: "ERP_NEXT_SYNC_STALE_OR_FAILED",
        severity: "CRITICAL",
        safeReferenceId: "erpnext-scheduled-sync",
        summary: "ERPNext synchronization is failed, incomplete, or stale.",
        remediation:
          "Inspect the latest safe sync code and correlation ID, resolve connectivity or record conflicts, then run one controlled synchronization.",
        metadata: {
          staleIntegrations:
            "staleIntegrations" in erpnext ? erpnext.staleIntegrations : 0,
          incompleteIntegrations:
            "incompleteIntegrations" in erpnext
              ? erpnext.incompleteIntegrations
              : 0,
          unresolvedEmployeeRecords:
            "unresolvedEmployeeRecords" in erpnext
              ? (erpnext.unresolvedEmployeeRecords ?? 0)
              : 0,
        },
      },
    },
    {
      active: reconciliation.status === "stale",
      definition: {
        deduplicationKey: "arc:reconciliation-stale",
        subsystem: "reconciliation",
        kind: "RECONCILIATION_STALE",
        severity: "CRITICAL",
        safeReferenceId: "arc-reconciliation",
        summary: "Arc reconciliation is outside its freshness window.",
        remediation:
          "Inspect finalized-head lag and the persisted cursor, then run bounded catch-up without changing the cursor manually.",
        metadata: {
          backlogBlocks:
            "backlogBlocks" in reconciliation
              ? (reconciliation.backlogBlocks ?? "unknown")
              : "unknown",
        },
      },
    },
    {
      active:
        reconciliation.status === "unhealthy" ||
        reconciliationFailures >= input.failureThreshold,
      definition: {
        deduplicationKey: "arc:reconciliation-failing",
        subsystem: "reconciliation",
        kind: "RECONCILIATION_REPEATED_FAILURE",
        severity: "CRITICAL",
        safeReferenceId: "arc-reconciliation",
        summary: "Arc reconciliation has repeated failures.",
        remediation:
          "Verify RPC and contract configuration, inspect the safe failure counters, and retry the same bounded cursor range.",
        metadata: {
          consecutiveFailures: reconciliationFailures,
        },
      },
    },
    {
      active:
        conflictingEvents > 0 ||
        unmatchedEvents >= input.unmatchedEventThreshold,
      definition: {
        deduplicationKey: "arc:onchain-database-discrepancy",
        subsystem: "reconciliation",
        kind: "ONCHAIN_DATABASE_DISCREPANCY",
        severity: "CRITICAL",
        safeReferenceId: "arc-reconciliation",
        summary: "Canonical chain events do not fully match database records.",
        remediation:
          "Review unmatched and conflicting event evidence; do not rewrite ledger history or replay financial submission.",
        metadata: {
          unmatchedEvents,
          conflictingEvents,
        },
      },
    },
    {
      active: (transactions?.ambiguousOutcomes ?? 0) > 0,
      definition: {
        deduplicationKey: "transactions:ambiguous-outcome",
        subsystem: "transaction_confirmation",
        kind: "AMBIGUOUS_TRANSACTION_OUTCOME",
        severity: "CRITICAL",
        safeReferenceId: "transaction-confirmation",
        summary:
          "One or more submitted transactions have an unresolved outcome.",
        remediation:
          "Resolve each existing transaction hash and canonical receipt before any retry or replacement submission.",
        metadata: {
          ambiguousOutcomes: transactions?.ambiguousOutcomes ?? 0,
        },
      },
    },
    {
      active: (transactions?.failedOperations ?? 0) > 0,
      definition: {
        deduplicationKey: "transactions:failed-receipt",
        subsystem: "transaction_confirmation",
        kind: "FAILED_TRANSACTION_RECEIPT",
        severity: "CRITICAL",
        safeReferenceId: "transaction-receipts",
        summary: "One or more financial transaction operations failed.",
        remediation:
          "Inspect the original receipt and audit evidence; only start a new operation after confirming the failed outcome.",
        metadata: {
          failedOperations: transactions?.failedOperations ?? 0,
        },
      },
    },
    {
      active: (transactions?.failedRepayments ?? 0) >= input.failureThreshold,
      definition: {
        deduplicationKey: "repayments:repeated-processing-failure",
        subsystem: "repayments",
        kind: "REPEATED_REPAYMENT_PROCESSING_FAILURE",
        severity: "CRITICAL",
        safeReferenceId: "repayment-processing",
        summary: "Repayment processing failures reached the alert threshold.",
        remediation:
          "Inspect failed repayment request IDs and their original receipts; do not create replacement repayments for ambiguous hashes.",
        metadata: {
          failedRepayments: transactions?.failedRepayments ?? 0,
          threshold: input.failureThreshold,
        },
      },
    },
    {
      active: (report.incidents?.failedDeliveries ?? 0) > 0,
      definition: {
        deduplicationKey: "alerts:delivery-failure",
        subsystem: "alerts",
        kind: "ALERT_DELIVERY_FAILURE",
        severity: "CRITICAL",
        safeReferenceId: "operational-alert-delivery",
        summary: "Operational alert delivery is failing.",
        remediation:
          "Inspect the webhook receiver and authentication configuration; pending alerts will retry after the cooldown.",
        metadata: {
          failedDeliveries: report.incidents?.failedDeliveries ?? 0,
        },
      },
    },
  ];

  for (const job of report.jobs) {
    checks.push({
      active: job.status === "unhealthy",
      definition: {
        deduplicationKey: `scheduler:${job.jobKey}`,
        subsystem: job.subsystem,
        kind: job.missed ? "SCHEDULER_EXECUTION_MISSED" : "SCHEDULER_FAILURE",
        severity: "CRITICAL",
        safeReferenceId: job.jobKey,
        summary: job.missed
          ? "A scheduled operational job missed its expected execution window."
          : "A scheduled operational job is repeatedly failing.",
        remediation:
          "Inspect the scheduler container and authenticated endpoint, then resume the existing job without resetting financial state.",
        metadata: {
          missed: job.missed,
          consecutiveFailures: job.consecutiveFailures,
          intervalSeconds: job.intervalSeconds,
        },
      },
    });
  }
  return checks;
}

export async function evaluateOperationalIncidents(input: {
  report: OperationalHealthReport;
  failureThreshold: number;
  unmatchedEventThreshold: number;
  repository: OperationalIncidentRepository;
  sender: OperationalIncidentSender;
  now?: Date;
  retryAfterMs?: number;
}) {
  const checks = deriveOperationalIncidentChecks(input);
  const results = [];
  for (const check of checks) {
    results.push(
      await transitionOperationalIncident({
        ...check,
        repository: input.repository,
        sender: input.sender,
        now: input.now,
        retryAfterMs: input.retryAfterMs,
      }),
    );
  }
  return results;
}
