import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  ReconciliationEventSource,
  ReconciliationRepository,
} from "@/modules/blockchain-reconciliation/application/ports";
import {
  reconcileBlockchainEvents,
  type ReconciliationConfig,
} from "@/modules/blockchain-reconciliation/application/reconcile-blockchain-events";
import type {
  ReconciliationEvent,
  StoredReconciliationEvent,
} from "@/modules/blockchain-reconciliation/domain/blockchain-event";

const contractAddress = "0x1111111111111111111111111111111111111111";
const blockHash = `0x${"a".repeat(64)}` as const;
const transactionHash = `0x${"b".repeat(64)}` as const;
const now = new Date("2026-10-03T12:00:00.000Z");

const config: ReconciliationConfig = {
  chainId: 5_042_002,
  contractAddress,
  startBlock: 1n,
  confirmationDepth: 2,
  blockRange: 10,
  reorgWindow: 5,
  maxRangesPerRun: 10,
  eventBatchSize: 100,
  rpcMaxRetries: 3,
  retryBaseDelayMs: 1,
  leaseDurationMs: 60_000,
};

function loanStartedEvent(blockNumber = 5n, logIndex = 0): ReconciliationEvent {
  return {
    name: "LOAN_STARTED",
    blockNumber,
    blockHash,
    blockTimestamp: now,
    transactionHash,
    logIndex,
    payload: {
      loanId: "7",
      offerId: "3",
      lender: "0x2222222222222222222222222222222222222222",
      borrower: "0x3333333333333333333333333333333333333333",
      principal: "100000000",
      repaymentAmount: "105000000",
      startTime: "1791028800",
      dueTime: "1793620800",
    },
  };
}

function repaymentEvent(blockNumber = 6n, logIndex = 1): ReconciliationEvent {
  return {
    name: "LOAN_REPAID",
    blockNumber,
    blockHash,
    blockTimestamp: now,
    transactionHash: `0x${"c".repeat(64)}`,
    logIndex,
    payload: {
      loanId: "7",
      borrower: "0x3333333333333333333333333333333333333333",
      lender: "0x2222222222222222222222222222222222222222",
      amount: "105000000",
      repaidAt: "1791032400",
    },
  };
}

type MemoryEvent = StoredReconciliationEvent & {
  finalized: boolean;
  status: "PROVISIONAL" | "APPLIED" | "UNMATCHED" | "CONFLICT" | "REORGED";
};

class MemoryRepository implements ReconciliationRepository {
  nextBlock = 1n;
  leased = false;
  events = new Map<string, MemoryEvent>();
  applied: string[] = [];
  loanAvailable = false;

  async acquireLease(input: { startBlock: bigint }) {
    if (this.leased) return null;
    this.leased = true;
    if (this.nextBlock < input.startBlock) this.nextBlock = input.startBlock;
    return { nextBlock: this.nextBlock };
  }

  async recordRange(input: {
    events: ReconciliationEvent[];
    finalizedThrough: bigint;
    fromBlock: bigint;
    toBlock: bigint;
  }) {
    const seen = new Set(
      input.events.map((event) => `${event.transactionHash}:${event.logIndex}`),
    );
    for (const event of this.events.values()) {
      if (
        event.blockNumber >= input.fromBlock &&
        event.blockNumber <= input.toBlock &&
        !seen.has(`${event.transactionHash}:${event.logIndex}`) &&
        event.status !== "REORGED"
      ) {
        event.status =
          event.finalized || event.status === "APPLIED"
            ? "CONFLICT"
            : "REORGED";
      }
    }
    for (const event of input.events) {
      const key = `${event.transactionHash}:${event.logIndex}`;
      const prior = this.events.get(key);
      this.events.set(key, {
        ...event,
        id: prior?.id ?? key,
        finalized: event.blockNumber <= input.finalizedThrough,
        status: prior?.status === "APPLIED" ? "APPLIED" : "PROVISIONAL",
      });
    }
    this.nextBlock =
      this.nextBlock > input.toBlock + 1n ? this.nextBlock : input.toBlock + 1n;
  }

  async renewLease() {
    return this.leased;
  }

  async listReadyEvents() {
    return [...this.events.values()]
      .filter(
        (event) =>
          event.finalized &&
          (event.status === "PROVISIONAL" || event.status === "UNMATCHED"),
      )
      .sort(
        (left, right) =>
          Number(left.blockNumber - right.blockNumber) ||
          left.logIndex - right.logIndex,
      );
  }

  async applyEvent(event: StoredReconciliationEvent) {
    const stored = this.events.get(
      `${event.transactionHash}:${event.logIndex}`,
    )!;
    if (stored.status === "APPLIED")
      return { kind: "ALREADY_APPLIED" } as const;
    if (event.name === "LOAN_REPAID" && !this.loanAvailable) {
      stored.status = "UNMATCHED";
      return {
        kind: "UNMATCHED",
        code: "CHAIN_LOAN_NOT_FOUND",
        note: "Loan has not been applied yet.",
      } as const;
    }
    if (event.name === "LOAN_STARTED") this.loanAvailable = true;
    stored.status = "APPLIED";
    this.applied.push(event.name);
    return {
      kind: "APPLIED",
      organizationId: "20000000-0000-4000-8000-000000000001",
      recordId: "30000000-0000-4000-8000-000000000001",
    } as const;
  }

  async flagConflict(eventId: string) {
    const event = [...this.events.values()].find(({ id }) => id === eventId);
    if (event) event.status = "CONFLICT";
  }

  async releaseLease() {
    this.leased = false;
  }
}

function source(
  input: {
    latest?: bigint;
    events?: ReconciliationEvent[];
    getEvents?: ReconciliationEventSource["getEvents"];
    verify?: boolean;
  } = {},
): ReconciliationEventSource {
  return {
    getChainId: vi.fn().mockResolvedValue(config.chainId),
    getLatestBlockNumber: vi.fn().mockResolvedValue(input.latest ?? 10n),
    getEvents: input.getEvents ?? vi.fn().mockResolvedValue(input.events ?? []),
    verifyEvent: vi.fn().mockResolvedValue(input.verify ?? true),
  };
}

const clock = {
  now: () => now,
  sleep: vi.fn().mockResolvedValue(undefined),
};

describe("blockchain reconciliation worker", () => {
  it("recovers a finalized event when the frontend callback was missed", async () => {
    const repository = new MemoryRepository();
    const result = await reconcileBlockchainEvents(
      config,
      repository,
      source({ events: [loanStartedEvent()] }),
      clock,
    );

    expect(result).toMatchObject({ status: "COMPLETED", appliedEvents: 1 });
    expect(repository.applied).toEqual(["LOAN_STARTED"]);
  });

  it("does not apply a duplicate event twice", async () => {
    const repository = new MemoryRepository();
    const eventSource = source({ events: [loanStartedEvent()] });
    await reconcileBlockchainEvents(config, repository, eventSource, clock);
    await reconcileBlockchainEvents(config, repository, eventSource, clock);

    expect(repository.applied).toEqual(["LOAN_STARTED"]);
    expect(repository.events).toHaveLength(1);
  });

  it("resumes from the persistent cursor while rechecking the recent window", async () => {
    const repository = new MemoryRepository();
    const getEvents = vi.fn().mockResolvedValue([]);
    await reconcileBlockchainEvents(
      config,
      repository,
      source({ latest: 10n, getEvents }),
      clock,
    );
    await reconcileBlockchainEvents(
      config,
      repository,
      source({ latest: 15n, getEvents }),
      clock,
    );

    expect(getEvents.mock.calls[0]).toEqual([1n, 10n]);
    expect(getEvents.mock.calls[1]).toEqual([6n, 15n]);
    expect(repository.nextBlock).toBe(16n);
  });

  it("retries a transient RPC timeout without advancing early", async () => {
    const repository = new MemoryRepository();
    const getEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce([loanStartedEvent()]);
    const result = await reconcileBlockchainEvents(
      config,
      repository,
      source({ getEvents }),
      clock,
    );

    expect(getEvents).toHaveBeenCalledTimes(2);
    expect(clock.sleep).toHaveBeenCalled();
    expect(result).toMatchObject({ appliedEvents: 1 });
  });

  it("sorts out-of-order events before applying dependent transitions", async () => {
    const repository = new MemoryRepository();
    await reconcileBlockchainEvents(
      config,
      repository,
      source({ events: [repaymentEvent(), loanStartedEvent()] }),
      clock,
    );

    expect(repository.applied).toEqual(["LOAN_STARTED", "LOAN_REPAID"]);
  });

  it("keeps an unmatched event visible and retries it after its dependency arrives", async () => {
    const repository = new MemoryRepository();
    const first = await reconcileBlockchainEvents(
      config,
      repository,
      source({ events: [repaymentEvent()] }),
      clock,
    );
    expect(first).toMatchObject({ unmatchedEvents: 1, appliedEvents: 0 });
    expect([...repository.events.values()][0].status).toBe("UNMATCHED");

    const second = await reconcileBlockchainEvents(
      config,
      repository,
      source({ events: [repaymentEvent(), loanStartedEvent()] }),
      clock,
    );
    expect(second).toMatchObject({ appliedEvents: 2 });
    expect(repository.applied).toEqual(["LOAN_STARTED", "LOAN_REPAID"]);
  });

  it("does not mark anything successful when a transaction has no event", async () => {
    const repository = new MemoryRepository();
    const result = await reconcileBlockchainEvents(
      config,
      repository,
      source({ events: [] }),
      clock,
    );

    expect(result).toMatchObject({ appliedEvents: 0 });
    expect(repository.applied).toEqual([]);
  });

  it("flags a finalized event whose escrow state does not match", async () => {
    const repository = new MemoryRepository();
    const result = await reconcileBlockchainEvents(
      config,
      repository,
      source({ events: [loanStartedEvent()], verify: false }),
      clock,
    );

    expect(result).toMatchObject({ conflictEvents: 1, appliedEvents: 0 });
    expect([...repository.events.values()][0].status).toBe("CONFLICT");
  });

  it("removes a provisional event when a reorganization occurs", async () => {
    const repository = new MemoryRepository();
    await reconcileBlockchainEvents(
      config,
      repository,
      source({ latest: 10n, events: [loanStartedEvent(10n)] }),
      clock,
    );
    expect([...repository.events.values()][0].status).toBe("PROVISIONAL");

    await reconcileBlockchainEvents(
      config,
      repository,
      source({ latest: 11n, events: [] }),
      clock,
    );
    expect([...repository.events.values()][0].status).toBe("REORGED");
    expect(repository.applied).toEqual([]);
  });

  it("flags but does not reverse a missing finalized event", async () => {
    const repository = new MemoryRepository();
    await reconcileBlockchainEvents(
      config,
      repository,
      source({ latest: 10n, events: [loanStartedEvent(8n)] }),
      clock,
    );
    await reconcileBlockchainEvents(
      config,
      repository,
      source({ latest: 11n, events: [] }),
      clock,
    );

    expect([...repository.events.values()][0].status).toBe("CONFLICT");
    expect(repository.applied).toEqual(["LOAN_STARTED"]);
  });

  it("skips an overlapping worker while the first lease is active", async () => {
    const repository = new MemoryRepository();
    let releaseEvents!: () => void;
    const waiting = new Promise<void>((resolve) => {
      releaseEvents = resolve;
    });
    const first = reconcileBlockchainEvents(
      config,
      repository,
      source({
        getEvents: vi.fn(async () => {
          await waiting;
          return [];
        }),
      }),
      clock,
    );
    await vi.waitFor(() => expect(repository.leased).toBe(true));
    const second = await reconcileBlockchainEvents(
      config,
      repository,
      source(),
      clock,
    );
    releaseEvents();
    await first;

    expect(second.status).toBe("SKIPPED_CONCURRENT");
  });
});
