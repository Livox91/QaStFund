export type ReconciliationEventName =
  "OFFER_CREATED" | "LOAN_STARTED" | "LOAN_REPAID";

type EventBase = Readonly<{
  blockHash: `0x${string}`;
  blockNumber: bigint;
  blockTimestamp: Date;
  logIndex: number;
  transactionHash: `0x${string}`;
}>;

export type OfferCreatedEvent = EventBase &
  Readonly<{
    name: "OFFER_CREATED";
    payload: {
      offerId: string;
      lender: string;
      principal: string;
      interestBps: string;
      duration: string;
      requestId: string;
    };
  }>;

export type LoanStartedEvent = EventBase &
  Readonly<{
    name: "LOAN_STARTED";
    payload: {
      loanId: string;
      offerId: string;
      lender: string;
      borrower: string;
      principal: string;
      repaymentAmount: string;
      startTime: string;
      dueTime: string;
    };
  }>;

export type LoanRepaidEvent = EventBase &
  Readonly<{
    name: "LOAN_REPAID";
    payload: {
      loanId: string;
      borrower: string;
      lender: string;
      amount: string;
      repaidAt: string;
    };
  }>;

export type ReconciliationEvent =
  OfferCreatedEvent | LoanStartedEvent | LoanRepaidEvent;

export type StoredReconciliationEvent = ReconciliationEvent &
  Readonly<{ id: string }>;
