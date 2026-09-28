import { describe, expect, it, vi } from "vitest";

import { getHealthStatus } from "@/server/application/health/get-health-status";
import type { HealthRepository } from "@/server/repositories/health-repository";

describe("getHealthStatus", () => {
  it("reports a connected database after a successful ping", async () => {
    const ping = vi.fn(async () => undefined);
    const repository: HealthRepository = { ping };

    await expect(getHealthStatus(repository)).resolves.toEqual({
      status: "ok",
      database: "connected",
    });
    expect(ping).toHaveBeenCalledOnce();
  });

  it("does not report success when the database ping fails", async () => {
    const databaseError = new Error("database unavailable");
    const repository: HealthRepository = {
      ping: vi.fn(async () => {
        throw databaseError;
      }),
    };

    await expect(getHealthStatus(repository)).rejects.toBe(databaseError);
  });
});
