import { describe, expect, it } from "vitest";

import {
  parseSchedulerConfig,
  runPeriodicJobIteration,
} from "../scripts/run-arc-reconciliation-scheduler.mjs";

const base = { ARC_RECONCILIATION_CRON_SECRET: "r".repeat(32) };

describe("scheduler periodic jobs", () => {
  it("enables repayment operations and the agent only when their secrets are set", () => {
    expect(parseSchedulerConfig(base).periodicJobs).toEqual([]);
    const config = parseSchedulerConfig({
      ...base,
      REPAYMENT_OPERATIONS_CRON_SECRET: "o".repeat(32),
      REPAYMENT_AGENT_CRON_SECRET: "a".repeat(32),
      REPAYMENT_AGENT_INTERVAL_MINUTES: "15",
    });
    expect(
      config.periodicJobs.map((job) => [job.name, job.intervalMs]),
    ).toEqual([
      ["repayment_operations", 3_600_000],
      ["repayment_agent", 900_000],
    ]);
    expect(() =>
      parseSchedulerConfig({ ...base, REPAYMENT_AGENT_CRON_SECRET: "short" }),
    ).toThrow(/REPAYMENT_AGENT_CRON_SECRET/);
  });

  it("calls the job endpoint with its own bearer secret and counts failures", async () => {
    const config = parseSchedulerConfig({
      ...base,
      REPAYMENT_AGENT_CRON_SECRET: "a".repeat(32),
    });
    const [job] = config.periodicJobs;
    const requests = [];
    const state = { consecutiveFailures: 0, alertActive: false };
    await runPeriodicJobIteration(config, job, state, async (url, init) => {
      requests.push([url, init.headers.Authorization]);
      return new Response(JSON.stringify({ considered: 1 }), { status: 200 });
    });
    expect(requests).toEqual([
      [
        "http://app:3000/api/internal/repayment-agent",
        `Bearer ${"a".repeat(32)}`,
      ],
    ]);
    expect(state.consecutiveFailures).toBe(0);

    await runPeriodicJobIteration(
      config,
      job,
      state,
      async () => new Response("", { status: 503 }),
    );
    expect(state.consecutiveFailures).toBe(1);
  });
});
