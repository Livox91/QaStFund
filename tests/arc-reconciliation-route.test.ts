import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validateEnvironment: vi.fn(),
  runScheduledArcReconciliation: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/infrastructure/config/environment", () => ({
  validateEnvironment: mocks.validateEnvironment,
}));
vi.mock("@/infrastructure/logging/logger", () => ({
  logger: { error: mocks.error },
}));
vi.mock("@/modules/blockchain-reconciliation/index.server", () => ({
  runScheduledArcReconciliation: mocks.runScheduledArcReconciliation,
}));

import { POST } from "@/app/api/internal/arc-reconciliation/route";

describe("authenticated Arc reconciliation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateEnvironment.mockReturnValue({
      ARC_RECONCILIATION_ENABLED: true,
      ARC_RECONCILIATION_CRON_SECRET: "s".repeat(32),
    });
  });

  it("rejects missing and invalid bearer credentials without running work", async () => {
    for (const authorization of [null, "Bearer wrong"]) {
      const response = await POST(
        new Request("http://app/api/internal/arc-reconciliation", {
          method: "POST",
          headers: authorization ? { authorization } : undefined,
        }),
      );
      expect(response.status).toBe(401);
    }
    expect(mocks.runScheduledArcReconciliation).not.toHaveBeenCalled();
  });

  it("runs one authenticated pass and returns bounded backlog state", async () => {
    mocks.runScheduledArcReconciliation.mockResolvedValue({
      status: "COMPLETED",
      scannedRanges: 2,
      remainingBacklogBlocks: "0",
      caughtUp: true,
      alerts: [],
    });
    const response = await POST(
      new Request("http://app/api/internal/arc-reconciliation", {
        method: "POST",
        headers: { authorization: `Bearer ${"s".repeat(32)}` },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "COMPLETED",
      remainingBacklogBlocks: "0",
      caughtUp: true,
    });
    expect(mocks.runScheduledArcReconciliation).toHaveBeenCalledOnce();
  });

  it("returns a sanitized retryable failure", async () => {
    mocks.runScheduledArcReconciliation.mockRejectedValue(
      new Error("RPC secret detail"),
    );
    const response = await POST(
      new Request("http://app/api/internal/arc-reconciliation", {
        method: "POST",
        headers: { authorization: `Bearer ${"s".repeat(32)}` },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "RECONCILIATION_FAILED",
      retryable: true,
    });
  });
});
