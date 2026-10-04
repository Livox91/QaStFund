import { describe, expect, it, vi } from "vitest";

import {
  getLivenessStatus,
  getReadinessStatus,
} from "@/server/application/health/get-health-status";
import type { HealthRepository } from "@/server/repositories/health-repository";

describe("application health", () => {
  it("reports liveness without consulting unavailable dependencies", () => {
    expect(getLivenessStatus()).toEqual({ status: "alive" });
  });

  it("reports readiness after a successful database ping", async () => {
    const ping = vi.fn(async () => undefined);
    const repository: HealthRepository = { ping };

    await expect(
      getReadinessStatus(repository, () => undefined),
    ).resolves.toEqual({
      status: "ready",
      checks: { configuration: "healthy", database: "healthy" },
    });
    expect(ping).toHaveBeenCalledOnce();
  });

  it("reports database failure without exposing its error", async () => {
    const repository: HealthRepository = {
      ping: vi.fn(async () => {
        throw new Error("postgres://operator:database-secret@db.internal/app");
      }),
    };

    const result = await getReadinessStatus(repository, () => undefined);
    expect(result).toEqual({
      status: "not_ready",
      checks: { configuration: "healthy", database: "unhealthy" },
    });
    expect(JSON.stringify(result)).not.toContain("database-secret");
  });

  it("does not make optional ERPNext part of readiness", async () => {
    const repository: HealthRepository = { ping: vi.fn(async () => undefined) };
    const result = await getReadinessStatus(repository, () => ({
      ERP_NEXT_SYNC_ENABLED: false,
    }));
    expect(result.status).toBe("ready");
  });
});
