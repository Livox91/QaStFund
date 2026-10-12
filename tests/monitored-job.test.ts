import { describe, expect, it, vi } from "vitest";

import {
  runMonitoredJob,
  type OperationalJobRepository,
} from "@/modules/operations/application/monitored-job";

function repository(): OperationalJobRepository {
  return {
    recordAttempt: vi.fn(async () => undefined),
    recordSuccess: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
  };
}

describe("monitored operational jobs", () => {
  it("records an attempt and success", async () => {
    const store = repository();
    await expect(
      runMonitoredJob({
        jobKey: "arc-reconciliation",
        subsystem: "reconciliation",
        intervalSeconds: 60,
        safeErrorCode: "RECONCILIATION_FAILED",
        repository: store,
        run: async () => "ok",
      }),
    ).resolves.toBe("ok");
    expect(store.recordAttempt).toHaveBeenCalledOnce();
    expect(store.recordSuccess).toHaveBeenCalledOnce();
    expect(store.recordFailure).not.toHaveBeenCalled();
  });

  it("records only a safe failure code and rethrows the original error", async () => {
    const store = repository();
    const error = new Error("https://user:secret@rpc.example.test");
    await expect(
      runMonitoredJob({
        jobKey: "arc-reconciliation",
        subsystem: "reconciliation",
        intervalSeconds: 60,
        safeErrorCode: "RECONCILIATION_FAILED",
        repository: store,
        run: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
    expect(store.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ safeErrorCode: "RECONCILIATION_FAILED" }),
    );
    expect(
      JSON.stringify(vi.mocked(store.recordFailure).mock.calls),
    ).not.toContain("user:secret");
  });
});
