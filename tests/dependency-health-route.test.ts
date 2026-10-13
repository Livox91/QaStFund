import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfiguredDependencyHealth: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/infrastructure/logging/logger", () => ({
  logger: { error: mocks.error },
}));
vi.mock("@/server/application/health/get-configured-dependency-health", () => ({
  getConfiguredDependencyHealth: mocks.getConfiguredDependencyHealth,
}));

import { GET, POST } from "@/app/api/health/dependencies/route";

const secret = "h".repeat(32);

function request(method: "GET" | "POST", authorization?: string) {
  return new Request("https://qastfund.example/api/health/dependencies", {
    method,
    headers: authorization ? { authorization } : undefined,
  });
}

describe("protected dependency health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPERATIONAL_HEALTH_SECRET", secret);
    mocks.getConfiguredDependencyHealth.mockResolvedValue({
      status: "healthy",
      checkedAt: "2026-10-13T12:00:00.000Z",
    });
  });

  it("rejects missing and invalid credentials before inspecting dependencies", async () => {
    for (const method of ["GET", "POST"] as const) {
      for (const authorization of [undefined, "Bearer wrong"]) {
        const response = await (method === "GET" ? GET : POST)(
          request(method, authorization),
        );
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({
          error: "UNAUTHORIZED",
        });
      }
    }
    expect(mocks.getConfiguredDependencyHealth).not.toHaveBeenCalled();
  });

  it("fails closed when the server health secret is not configured", async () => {
    vi.stubEnv("OPERATIONAL_HEALTH_SECRET", "");

    const response = await GET(request("GET", `Bearer ${secret}`));

    expect(response.status).toBe(401);
    expect(mocks.getConfiguredDependencyHealth).not.toHaveBeenCalled();
  });

  it("keeps authenticated GET read-only", async () => {
    const response = await GET(request("GET", `Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(mocks.getConfiguredDependencyHealth).toHaveBeenCalledWith({
      mode: "read-only",
    });
  });

  it("allows state-recording evaluation only through authenticated POST", async () => {
    const response = await POST(request("POST", `Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(mocks.getConfiguredDependencyHealth).toHaveBeenCalledWith({
      mode: "observe-and-record",
    });
  });

  it("returns a sanitized failure without leaking dependency errors", async () => {
    mocks.getConfiguredDependencyHealth.mockRejectedValue(
      new Error("postgresql://user:secret@database/private"),
    );

    const response = await GET(request("GET", `Bearer ${secret}`));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      error: "Dependency health check failed",
    });
  });
});
