import type { AgentDecision } from "@/modules/repayment-agent/domain/agent-decision";
import type {
  MandateSnapshot,
  ObligationView,
} from "@/modules/repayment-agent/domain/agent-policy";
import type {
  AgentRunStatus,
  AgentStep,
  AgentTrigger,
  InFlightOperation,
  PendingApproval,
  PolicyCheck,
  ReconciliationHealth,
} from "@/modules/repayment-agent/domain/agent-run";
import type { RepaymentVerification } from "@/modules/repayment-agent/domain/receipt-verification";

export type BorrowerRef = Readonly<{
  organizationId: string;
  borrowerMembershipId: string;
}>;

export type ChainLoanState = Readonly<{
  chainLoanId: string;
  borrower: string;
  lender: string;
  repaymentAmountBaseUnits: bigint;
  repaidBaseUnits: bigint;
  dueAt: Date;
  active: boolean;
}>;

export type BorrowerChainState = Readonly<{
  walletBalanceBaseUnits: bigint;
  allowanceBaseUnits: bigint;
  mandate: MandateSnapshot | null;
}>;

export type SimulationResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; errorName: string }>;

export type AgentRepaymentRequest = Readonly<{
  chainLoanId: string;
  amountBaseUnits: bigint;
  chainRepaymentId: `0x${string}`;
  mandateNonce: bigint;
}>;

export type ExpectedRepayment = Readonly<{
  chainLoanId: string;
  chainRepaymentId: `0x${string}`;
  amountBaseUnits: bigint;
  borrower: string;
  lender: string;
  /** Agent address for mandate repayments; null for borrower-signed approvals. */
  agent: string | null;
}>;

/** Arc (or local) chain access. The agent never builds arbitrary calldata. */
export interface RepaymentChainGateway {
  readonly agentAddress: string;
  readonly contractAddress: string;
  readonly usdcAddress: string;
  readBorrowerState(walletAddress: string): Promise<BorrowerChainState>;
  readLoan(chainLoanId: string): Promise<ChainLoanState>;
  simulateAgentRepayment(
    request: AgentRepaymentRequest,
  ): Promise<SimulationResult>;
  /**
   * Signs locally, hands the hash to `onSigned` (which must persist it), and
   * only then broadcasts. If `onSigned` throws, nothing is broadcast.
   */
  submitAgentRepayment(
    request: AgentRepaymentRequest,
    onSigned: (transactionHash: `0x${string}`) => Promise<void>,
  ): Promise<`0x${string}`>;
  /** Waits up to `timeoutMs` for the receipt, then verifies logs and state. */
  verifyRepayment(
    transactionHash: `0x${string}`,
    expected: ExpectedRepayment,
    timeoutMs: number,
  ): Promise<RepaymentVerification>;
}

export type BorrowerProfile = Readonly<{
  organizationId: string;
  borrowerMembershipId: string;
  userId: string;
  email: string;
  name: string;
  walletAddress: string | null;
  employmentActive: boolean;
}>;

export type StoredObligation = Omit<
  ObligationView,
  "repaidBaseUnits" | "outstandingBaseUnits" | "ref"
> &
  Readonly<{ lenderWalletAddress: string }>;

export type StoredAction = Readonly<{
  id: string;
  runId: string;
  loanId: string;
  action: string;
  amountBaseUnits: bigint | null;
  status: string;
  repaymentRequestId: string;
  chainRepaymentId: `0x${string}`;
  mandateNonce: bigint | null;
  transactionHash: `0x${string}` | null;
  attempts: number;
  expiresAt: Date | null;
  submittedAt: Date | null;
}>;

export type CreateActionInput = Readonly<{
  runId: string;
  /** Application id; the on-chain repayment id is derived from it. */
  repaymentRequestId: string;
  borrower: BorrowerRef;
  loanId: string;
  action: AgentDecision["action"];
  amountBaseUnits: bigint;
  status: "VALIDATED" | "AWAITING_APPROVAL";
  mandateNonce: bigint | null;
  decision: unknown;
  validation: ReadonlyArray<PolicyCheck>;
  expiresAt: Date | null;
}>;

export interface RepaymentAgentRepository {
  loadBorrower(borrower: BorrowerRef): Promise<BorrowerProfile | null>;
  listObligations(borrower: BorrowerRef): Promise<StoredObligation[]>;
  findInFlight(borrower: BorrowerRef): Promise<InFlightOperation | null>;
  findInFlightAction(borrower: BorrowerRef): Promise<StoredAction | null>;
  listPendingApprovals(borrower: BorrowerRef): Promise<PendingApproval[]>;
  listRecentPayments(
    borrower: BorrowerRef,
    since: Date,
  ): Promise<Array<{ loanId: string; at: Date }>>;
  listRecentFailures(
    borrower: BorrowerRef,
    since: Date,
  ): Promise<Array<{ code: string; at: Date }>>;
  expireApprovals(borrower: BorrowerRef, now: Date): Promise<number>;

  /** Throws `ConcurrentRunError` while another run for the borrower is active. */
  startRun(input: {
    borrower: BorrowerRef;
    trigger: AgentTrigger;
    plannerKind: "MODEL" | "RULES";
    plannerModel: string | null;
    promptVersion: string;
    policyVersion: string;
    startedAt: Date;
    parentRunId: string | null;
  }): Promise<{ id: string }>;
  appendStep(
    runId: string,
    borrower: BorrowerRef,
    sequence: number,
    step: AgentStep,
  ): Promise<void>;
  setRunSnapshot(runId: string, snapshot: unknown): Promise<void>;
  finishRun(
    runId: string,
    input: {
      status: AgentRunStatus;
      outcomeCode: string;
      outcomeSummary: string;
      decision: unknown;
      requiresHumanApproval: boolean;
      completedAt: Date;
      plannerKind: "MODEL" | "RULES";
      plannerModel: string | null;
    },
  ): Promise<void>;

  /** Creates the action and, for payments, a PENDING repayment intent. */
  createAction(input: CreateActionInput): Promise<StoredAction>;
  /** Throws `DuplicateInFlightError` if another repayment is already in flight. */
  markSubmitted(
    actionId: string,
    transactionHash: `0x${string}`,
    at: Date,
  ): Promise<void>;
  markFailed(
    actionId: string,
    failureCode: string,
    verification: unknown,
  ): Promise<void>;
  /** Records the verified repayment, allocation and loan state atomically. */
  recordConfirmedRepayment(input: {
    actionId: string;
    borrower: BorrowerRef;
    loanId: string;
    transactionHash: `0x${string}`;
    verification: RepaymentVerification & { status: "VERIFIED" };
    confirmedAt: Date;
  }): Promise<void>;
}

/** Another agent run for the same borrower holds the run lease. */
export class ConcurrentRunError extends Error {
  constructor() {
    super("RUN_ALREADY_ACTIVE");
    this.name = "ConcurrentRunError";
  }
}

export class DuplicateInFlightError extends Error {
  constructor() {
    super("ANOTHER_REPAYMENT_IN_FLIGHT");
    this.name = "DuplicateInFlightError";
  }
}

export interface ReconciliationHealthReader {
  read(now: Date): Promise<ReconciliationHealth>;
}

export type AgentNotification = Readonly<{
  kind: "INFO" | "APPROVAL_REQUESTED" | "ESCALATION" | "PAYMENT_CONFIRMED";
  subject: string;
  text: string;
  idempotencyKey: string;
}>;

export interface RepaymentNotifier {
  notify(
    borrower: BorrowerProfile,
    notification: AgentNotification,
  ): Promise<{ delivered: boolean; code: string | null }>;
}
