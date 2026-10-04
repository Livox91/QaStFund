import type {
  ReconciliationEvent,
  StoredReconciliationEvent,
} from "@/modules/blockchain-reconciliation/domain/blockchain-event";

export type ReconciliationCursor = Readonly<{ nextBlock: bigint }>;

export interface ReconciliationEventSource {
  getChainId(): Promise<number>;
  getLatestBlockNumber(): Promise<bigint>;
  getEvents(fromBlock: bigint, toBlock: bigint): Promise<ReconciliationEvent[]>;
  verifyEvent(event: StoredReconciliationEvent): Promise<boolean>;
}

export interface ReconciliationRepository {
  acquireLease(input: {
    chainId: number;
    contractAddress: string;
    leaseOwner: string;
    leaseExpiresAt: Date;
    now: Date;
    startBlock: bigint;
  }): Promise<ReconciliationCursor | null>;
  recordRange(input: {
    chainId: number;
    contractAddress: string;
    events: ReconciliationEvent[];
    finalizedThrough: bigint;
    fromBlock: bigint;
    leaseOwner: string;
    now: Date;
    toBlock: bigint;
  }): Promise<void>;
  renewLease(input: {
    chainId: number;
    contractAddress: string;
    leaseOwner: string;
    leaseExpiresAt: Date;
  }): Promise<boolean>;
  listReadyEvents(input: {
    chainId: number;
    contractAddress: string;
    limit: number;
  }): Promise<StoredReconciliationEvent[]>;
  applyEvent(
    event: StoredReconciliationEvent,
    now: Date,
  ): Promise<
    | { kind: "APPLIED"; organizationId: string; recordId: string }
    | { kind: "ALREADY_APPLIED" }
    | { kind: "UNMATCHED"; code: string; note: string }
    | { kind: "CONFLICT"; code: string; note: string }
  >;
  flagConflict(
    eventId: string,
    code: string,
    note: string,
    now: Date,
  ): Promise<void>;
  recordRunSuccess?(input: {
    chainId: number;
    contractAddress: string;
    latestObservedBlock: bigint;
    occurredAt: Date;
  }): Promise<void>;
  recordRunFailure?(input: {
    chainId: number;
    contractAddress: string;
    occurredAt: Date;
  }): Promise<void>;
  releaseLease(input: {
    chainId: number;
    contractAddress: string;
    leaseOwner: string;
  }): Promise<void>;
}
