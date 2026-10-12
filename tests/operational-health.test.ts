import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getOperationalSnapshot,
  evaluateOperationalThreshold,
  recordOperationalFailure,
  resetOperationalSignalsForTests,
} from "@/infrastructure/observability/operational-signals";
import { buildDependencyHealth } from "@/server/application/health/build-dependency-health";
import { evaluateReconciliationHealth } from "@/server/application/health/get-dependency-health";

describe("operational health", () => {
  beforeEach(() => resetOperationalSignalsForTests());

  it("reports blockchain dependency failure without configuration secrets", () => {
    const report = buildDependencyHealth({
      now: new Date("2026-10-04T12:00:00.000Z"),
      reconciliationEnabled: false,
      reconciliationStaleAfterMs: 60_000,
      reconciliationState: null,
      latestObservedBlock: null,
      failures: {},
      arc: { status: "unhealthy", contractConfigured: true },
      circleConfigured: true,
      erpEnabled: false,
      erpState: null,
      pendingTransactionCount: 2,
      metrics: {},
      timers: {},
    });
    expect(report.status).toBe("degraded");
    expect(report.dependencies.arc.status).toBe("unhealthy");
    expect(JSON.stringify(report)).not.toMatch(
      /secret|private.?key|credential/i,
    );
  });

  it("detects stale reconciliation state", () => {
    const result = evaluateReconciliationHealth({
      enabled: true,
      cursor: {
        nextBlock: 121n,
        finalizedThrough: 115n,
        updatedAt: new Date("2026-10-04T11:00:00.000Z"),
        lastSuccessfulAt: new Date("2026-10-04T11:00:00.000Z"),
      },
      latestObservedBlock: "120",
      lastSuccessfulAt: null,
      failureCount: 0,
      unmatchedEvents: 0,
      conflictingEvents: 0,
      staleAfterMs: 15 * 60_000,
      now: new Date("2026-10-04T12:00:00.000Z"),
    });
    expect(result.status).toBe("stale");
    expect(result.lastSuccessfullyReconciledBlock).toBe("115");
  });

  it("detects finalized-head backlog before the time threshold expires", () => {
    const result = evaluateReconciliationHealth({
      enabled: true,
      cursor: {
        nextBlock: 101n,
        finalizedThrough: 100n,
        updatedAt: new Date("2026-10-04T11:59:30.000Z"),
        lastSuccessfulAt: new Date("2026-10-04T11:59:30.000Z"),
      },
      latestObservedBlock: "100",
      latestChainBlock: 250n,
      confirmationDepth: 5,
      healthWindowBlocks: 100,
      maxRangesPerRun: 10,
      lastSuccessfulAt: null,
      failureCount: 0,
      unmatchedEvents: 0,
      conflictingEvents: 0,
      staleAfterMs: 15 * 60_000,
      now: new Date("2026-10-04T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "stale",
      finalizedChainHead: "245",
      backlogBlocks: "145",
      healthWindowBlocks: "100",
      maxBlocksPerRun: "1000",
      caughtUp: false,
    });
  });

  it("treats a canonical event conflict as unhealthy even when the cursor is fresh", () => {
    const result = evaluateReconciliationHealth({
      enabled: true,
      cursor: {
        nextBlock: 121n,
        finalizedThrough: 120n,
        updatedAt: new Date("2026-10-04T11:59:30.000Z"),
        lastSuccessfulAt: new Date("2026-10-04T11:59:30.000Z"),
      },
      latestObservedBlock: "120",
      lastSuccessfulAt: null,
      failureCount: 0,
      unmatchedEvents: 0,
      conflictingEvents: 1,
      staleAfterMs: 15 * 60_000,
      now: new Date("2026-10-04T12:00:00.000Z"),
    });
    expect(result.status).toBe("unhealthy");
    expect(result.conflictingEvents).toBe(1);
  });

  it("distinguishes ERPNext connectivity from complete, fresh synchronization", () => {
    const report = buildDependencyHealth({
      now: new Date("2026-10-11T12:00:00.000Z"),
      reconciliationEnabled: false,
      reconciliationStaleAfterMs: 60_000,
      reconciliationState: null,
      latestObservedBlock: null,
      failures: {},
      arc: {
        status: "healthy",
        contractConfigured: true,
      },
      circleConfigured: true,
      erpEnabled: true,
      erpState: {
        configuredIntegrations: 1,
        connectedIntegrations: 1,
        incompleteIntegrations: 1,
        staleIntegrations: 1,
        unresolvedEmployeeRecords: 3,
        lastAttemptedAt: new Date("2026-10-11T11:00:00.000Z"),
        lastSuccessfulAt: new Date("2026-10-10T11:00:00.000Z"),
        lastResult: "PARTIAL",
      },
      pendingTransactionCount: 0,
      metrics: {},
      timers: {},
    });

    expect(report.status).toBe("degraded");
    expect(report.dependencies.erpnext).toMatchObject({
      status: "unhealthy",
      connectedIntegrations: 1,
      incompleteIntegrations: 1,
      staleIntegrations: 1,
      unresolvedEmployeeRecords: 3,
      lastAttemptedAt: "2026-10-11T11:00:00.000Z",
      lastSuccessfulAt: "2026-10-10T11:00:00.000Z",
      lastResult: "PARTIAL",
    });
  });

  it("reports transaction phases, overdue repayments, missed jobs, and alert delivery failures", () => {
    const report = buildDependencyHealth({
      now: new Date("2026-10-12T12:03:01.000Z"),
      reconciliationEnabled: false,
      reconciliationStaleAfterMs: 60_000,
      reconciliationState: null,
      latestObservedBlock: null,
      failures: {},
      arc: { status: "healthy", contractConfigured: true },
      circleConfigured: true,
      erpEnabled: false,
      erpState: null,
      transactionState: {
        pendingSubmission: 2,
        pendingConfirmation: 3,
        pendingReconciliation: 4,
        ambiguousOutcomes: 1,
        failedOperations: 0,
        failedRepayments: 0,
        overdueRepayments: 5,
      },
      operationalJobs: [
        {
          jobKey: "arc-reconciliation",
          subsystem: "reconciliation",
          intervalSeconds: 60,
          lastAttemptedAt: new Date("2026-10-12T12:00:00.000Z"),
          lastSucceededAt: new Date("2026-10-12T12:00:00.000Z"),
          lastFailedAt: null,
          nextExpectedAt: new Date("2026-10-12T12:01:00.000Z"),
          consecutiveFailures: 0,
          lastSafeErrorCode: null,
        },
      ],
      schedulerGraceMs: 120_000,
      incidentDeliveryState: {
        activeIncidents: 2,
        pendingDeliveries: 1,
        failedDeliveries: 1,
      },
      metrics: {},
      timers: {},
    });

    expect(report.status).toBe("degraded");
    expect(report.metrics.pendingTransactionCount).toBe(9);
    expect(report.transactions).toMatchObject({
      pendingSubmission: 2,
      pendingConfirmation: 3,
      pendingReconciliation: 4,
      ambiguousOutcomes: 1,
    });
    expect(report.repayments.overdue).toBe(5);
    expect(report.jobs[0]).toMatchObject({
      status: "unhealthy",
      missed: true,
    });
    expect(report.incidents?.failedDeliveries).toBe(1);
  });

  it("alerts only when repeated failures reach the threshold", () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    recordOperationalFailure("circle", { alertThreshold: 3 });
    recordOperationalFailure("circle", { alertThreshold: 3 });
    expect(warning).not.toHaveBeenCalled();
    recordOperationalFailure("circle", { alertThreshold: 3 });
    expect(warning).toHaveBeenCalledTimes(1);
    expect(getOperationalSnapshot().failures.circle?.consecutiveFailures).toBe(
      3,
    );
    warning.mockRestore();
  });

  it("emits one alert while a threshold condition remains active", () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    expect(evaluateOperationalThreshold("unmatched_events", 9, 10)).toBe(false);
    expect(evaluateOperationalThreshold("unmatched_events", 10, 10)).toBe(true);
    expect(evaluateOperationalThreshold("unmatched_events", 11, 10)).toBe(true);
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });
});
