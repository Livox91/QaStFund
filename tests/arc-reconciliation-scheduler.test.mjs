import { describe, expect, it, vi } from "vitest";

import {
  parseSchedulerConfig,
  runErpNextSchedulerIteration,
  runSchedulerIteration,
} from "../scripts/run-arc-reconciliation-scheduler.mjs";

describe("Arc reconciliation scheduler sidecar", () => {
  it("validates the secret and bounded interval", () => {
    expect(() => parseSchedulerConfig({})).toThrow(/CRON_SECRET/);
    expect(() =>
      parseSchedulerConfig({
        ARC_RECONCILIATION_CRON_SECRET: "s".repeat(32),
        ARC_RECONCILIATION_INTERVAL_SECONDS: "5",
      }),
    ).toThrow(/INTERVAL_SECONDS/);
  });

  it("authenticates each trigger and reports endpoint failure and recovery once", async () => {
    const config = parseSchedulerConfig({
      ARC_RECONCILIATION_CRON_SECRET: "s".repeat(32),
      ARC_RECONCILIATION_INTERVAL_SECONDS: "60",
      OBSERVABILITY_FAILURE_ALERT_THRESHOLD: "2",
      OPERATIONAL_ALERT_WEBHOOK_URL: "https://alerts.example.test/arc",
    });
    const state = { consecutiveFailures: 0, alertActive: false };
    let endpointCalls = 0;
    const request = vi.fn(async (url, init) => {
      if (url === config.endpoint) {
        endpointCalls += 1;
        expect(init.headers.Authorization).toBe(`Bearer ${config.secret}`);
        if (endpointCalls === 1) throw new Error("connection refused");
        if (endpointCalls === 2) {
          return Response.json(
            { error: "RECONCILIATION_FAILED", retryable: true },
            { status: 503 },
          );
        }
        return Response.json({
          status: "COMPLETED",
          scannedRanges: 1,
          remainingBacklogBlocks: "0",
          caughtUp: true,
        });
      }
      return new Response(null, { status: 204 });
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await runSchedulerIteration(config, state, request);
    await runSchedulerIteration(config, state, request);
    await runSchedulerIteration(config, state, request);

    const webhookBodies = request.mock.calls
      .filter(([url]) => url === config.webhookUrl)
      .map(([, init]) => JSON.parse(init.body));
    expect(webhookBodies).toEqual([
      expect.objectContaining({ event: "ACTIVE" }),
      expect.objectContaining({ event: "RECOVERED" }),
    ]);
    expect(state).toEqual({ consecutiveFailures: 0, alertActive: false });
  });

  it("authenticates ERPNext syncs and alerts once for incomplete runs before recovery", async () => {
    const config = parseSchedulerConfig({
      ARC_RECONCILIATION_CRON_SECRET: "a".repeat(32),
      ERP_NEXT_SYNC_ENABLED: "true",
      ERP_NEXT_SYNC_CRON_SECRET: "e".repeat(32),
      ERP_NEXT_SYNC_INTERVAL_MINUTES: "15",
      OBSERVABILITY_FAILURE_ALERT_THRESHOLD: "2",
      OPERATIONAL_ALERT_WEBHOOK_URL: "https://alerts.example.test/erpnext",
    });
    const state = { consecutiveFailures: 0, alertActive: false };
    let syncCalls = 0;
    const request = vi.fn(async (url, init) => {
      if (url === config.erpNext.endpoint) {
        syncCalls += 1;
        expect(init.headers.Authorization).toBe(
          `Bearer ${config.erpNext.secret}`,
        );
        if (syncCalls <= 2) {
          return Response.json({
            considered: 1,
            succeeded: 0,
            partial: 1,
            failed: 0,
            skipped: 0,
          });
        }
        return Response.json({
          considered: 1,
          succeeded: 1,
          partial: 0,
          failed: 0,
          skipped: 0,
        });
      }
      return new Response(null, { status: 204 });
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await runErpNextSchedulerIteration(config, state, request);
    await runErpNextSchedulerIteration(config, state, request);
    await runErpNextSchedulerIteration(config, state, request);

    const webhookBodies = request.mock.calls
      .filter(([url]) => url === config.webhookUrl)
      .map(([, init]) => JSON.parse(init.body));
    expect(webhookBodies).toEqual([
      expect.objectContaining({
        alert: "erpnext_scheduler",
        event: "ACTIVE",
      }),
      expect.objectContaining({
        alert: "erpnext_scheduler",
        event: "RECOVERED",
      }),
    ]);
    expect(state).toEqual({ consecutiveFailures: 0, alertActive: false });
  });
});
