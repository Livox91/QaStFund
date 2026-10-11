import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOperationalAlertSender,
  transitionReconciliationAlert,
  type ReconciliationAlertRepository,
  type ReconciliationAlertState,
} from "@/modules/blockchain-reconciliation/application/reconciliation-alerts";

class MemoryAlertRepository implements ReconciliationAlertRepository {
  state: ReconciliationAlertState = "HEALTHY";
  pending = false;
  lastAttemptAt: Date | null = null;

  async prepareDelivery(input: {
    targetState: ReconciliationAlertState;
    now: Date;
    retryAfterMs: number;
  }) {
    const previousState = this.state;
    const changed = previousState !== input.targetState;
    const retryDue =
      this.pending &&
      (!this.lastAttemptAt ||
        input.now.getTime() - this.lastAttemptAt.getTime() >=
          input.retryAfterMs);
    if (changed || retryDue) {
      this.state = input.targetState;
      this.pending = true;
      this.lastAttemptAt = input.now;
    }
    return { deliver: changed || retryDue, previousState };
  }

  async markDelivered() {
    this.pending = false;
  }

  async markDeliveryFailed() {
    this.pending = true;
  }
}

const base = {
  chainId: 5_042_002,
  contractAddress: "0x1111111111111111111111111111111111111111",
  detail: "Reconciliation is stale.",
};

describe("reconciliation alert transitions", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("delivers one stale alert, suppresses duplicates, and reports recovery", async () => {
    const repository = new MemoryAlertRepository();
    const sender = vi.fn().mockResolvedValue("WEBHOOK" as const);

    await transitionReconciliationAlert({
      ...base,
      targetState: "STALE",
      repository,
      sender,
    });
    await transitionReconciliationAlert({
      ...base,
      targetState: "STALE",
      repository,
      sender,
    });
    await transitionReconciliationAlert({
      ...base,
      targetState: "HEALTHY",
      detail: "Reconciliation recovered.",
      repository,
      sender,
    });

    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[0][0]).toMatchObject({
      event: "ACTIVE",
      state: "STALE",
    });
    expect(sender.mock.calls[1][0]).toMatchObject({
      event: "RECOVERED",
      state: "HEALTHY",
      previousState: "STALE",
    });
  });

  it("keeps failed delivery pending and retries only after the cooldown", async () => {
    const repository = new MemoryAlertRepository();
    const sender = vi.fn().mockRejectedValue(new Error("unavailable"));
    const warning = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const first = new Date("2026-10-11T12:00:00.000Z");

    await transitionReconciliationAlert({
      ...base,
      targetState: "FAILING",
      repository,
      sender,
      now: first,
      retryAfterMs: 300_000,
    });
    await transitionReconciliationAlert({
      ...base,
      targetState: "FAILING",
      repository,
      sender,
      now: new Date(first.getTime() + 60_000),
      retryAfterMs: 300_000,
    });
    await transitionReconciliationAlert({
      ...base,
      targetState: "FAILING",
      repository,
      sender,
      now: new Date(first.getTime() + 300_000),
      retryAfterMs: 300_000,
    });

    expect(sender).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  it("sends the webhook token without placing it in the payload", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const sender = createOperationalAlertSender({
      webhookUrl: "https://alerts.example.test/arc",
      bearerToken: "dedicated-alert-token",
      fetchImplementation: request,
    });
    await sender({
      event: "ACTIVE",
      state: "STALE",
      previousState: "HEALTHY",
      occurredAt: "2026-10-11T12:00:00.000Z",
      chainId: 5_042_002,
      contractAddress: base.contractAddress,
      detail: base.detail,
      context: {},
    });

    expect(request).toHaveBeenCalledWith(
      "https://alerts.example.test/arc",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer dedicated-alert-token",
        }),
      }),
    );
    expect(request.mock.calls[0][1].body).not.toContain(
      "dedicated-alert-token",
    );
  });
});
