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
