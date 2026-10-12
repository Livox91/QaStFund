import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validateEnvironment: vi.fn(),
  runSyncs: vi.fn(),
  enforceRateLimit: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/infrastructure/config/environment", () => ({
  validateEnvironment: mocks.validateEnvironment,
}));
vi.mock("@/infrastructure/logging/logger", () => ({
  logger: { error: mocks.error },
}));
vi.mock("@/infrastructure/rate-limit/rate-limit", () => ({
  enforcePublicRateLimit: mocks.enforceRateLimit,
}));
vi.mock("@/modules/employee-directory/index.server", () => ({
  runConfiguredScheduledEmployeeDirectorySyncs: mocks.runSyncs,
}));
vi.mock("@/modules/operations/application/monitored-job", () => ({
  runMonitoredJob: vi.fn(async (input) => input.run()),
}));
vi.mock(
  "@/modules/operations/infrastructure/prisma-operational-job-repository",
  () => ({ prismaOperationalJobRepository: {} }),
);

import { POST } from "@/app/api/internal/erpnext-sync/route";

describe("authenticated ERPNext scheduler route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateEnvironment.mockReturnValue({
      ERP_NEXT_SYNC_ENABLED: true,
      ERP_NEXT_SYNC_CRON_SECRET: "e".repeat(32),
      ERP_NEXT_SYNC_INTERVAL_MINUTES: 15,
    });
  });

  function request(secret = "e".repeat(32)) {
    return new Request("http://app/api/internal/erpnext-sync", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
  }

  it("rejects invalid scheduler credentials", async () => {
    const response = await POST(request("wrong"));
    expect(response.status).toBe(401);
    expect(mocks.runSyncs).not.toHaveBeenCalled();
  });

  it("returns a sanitized failure when a scheduled run is incomplete", async () => {
    mocks.runSyncs.mockResolvedValue({
      considered: 1,
      succeeded: 0,
      partial: 1,
      failed: 0,
      skipped: 0,
    });
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "ERP_NEXT_SYNC_FAILED",
      retryable: true,
    });
  });

  it("returns the successful safe aggregate", async () => {
    mocks.runSyncs.mockResolvedValue({
      considered: 1,
      succeeded: 1,
      partial: 0,
      failed: 0,
      skipped: 0,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ succeeded: 1 });
  });
});
