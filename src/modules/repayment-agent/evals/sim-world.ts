import { agentRepaymentIdToBytes32 } from "@/integrations/arc/escrow-v3";
import type {
  PlannerRequest,
  PlannerResult,
  RepaymentPlanner,
} from "@/modules/repayment-agent/application/planner";
import {
  ConcurrentRunError,
  DuplicateInFlightError,
  type AgentNotification,
  type BorrowerProfile,
  type BorrowerRef,
  type CreateActionInput,
  type ReconciliationHealthReader,
  type RepaymentAgentRepository,
  type RepaymentNotifier,
  type StoredAction,
  type StoredObligation,
} from "@/modules/repayment-agent/application/ports";
import {
  runRepaymentAgent,
  type RepaymentAgentDependencies,
} from "@/modules/repayment-agent/application/run-repayment-agent";
import { ONE_USDC } from "@/modules/repayment-agent/domain/agent-policy";
import type {
  AgentStep,
  ReconciliationHealth,
} from "@/modules/repayment-agent/domain/agent-run";
import { SimulatedEscrowChain } from "@/modules/repayment-agent/evals/simulated-chain";
import { RuleBasedRepaymentPlanner } from "@/modules/repayment-agent/infrastructure/rule-based-planner";

const HOUR_MS = 3_600_000;

export class MutableClock {
  constructor(private current: Date) {}
  now() {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

type StoredRun = {
  id: string;
  status: string;
  outcomeCode: string | null;
  steps: Array<AgentStep & { sequence: number }>;
  snapshot: unknown;
  requiresHumanApproval: boolean;
};

export class InMemoryRepaymentAgentRepository implements RepaymentAgentRepository {
  readonly runs = new Map<string, StoredRun>();
  readonly actions = new Map<
    string,
    StoredAction & {
      borrowerMembershipId: string;
      confirmedAt: Date | null;
      failureCode: string | null;
    }
  >();
  readonly obligations = new Map<
    string,
    StoredObligation & { status: "ACTIVE" | "REPAID" }
  >();
  readonly confirmedRepayments: Array<{
    loanId: string;
    amountBaseUnits: bigint;
    transactionHash: string;
  }> = [];
  private sequence = 0;

  constructor(
    private readonly profile: BorrowerProfile,
    private readonly clock: MutableClock,
  ) {}

  private id() {
    return `00000000-0000-4000-8000-${(++this.sequence).toString(16).padStart(12, "0")}`;
  }

  async loadBorrower() {
    return this.profile;
  }
  async listObligations() {
    return [...this.obligations.values()].filter(
      (item) => item.status === "ACTIVE",
    );
  }
  async findInFlightAction(borrower: BorrowerRef) {
    return (
      [...this.actions.values()].find(
        (action) =>
          action.borrowerMembershipId === borrower.borrowerMembershipId &&
          action.status === "SUBMITTED",
      ) ?? null
    );
  }
  async findInFlight(borrower: BorrowerRef) {
    const action = await this.findInFlightAction(borrower);
    return action
      ? {
          actionId: action.id,
          loanId: action.loanId,
          amountBaseUnits: action.amountBaseUnits ?? 0n,
          transactionHash: action.transactionHash,
          submittedAt: action.submittedAt,
        }
      : null;
  }
  async listPendingApprovals() {
    return [...this.actions.values()]
      .filter((action) => action.status === "AWAITING_APPROVAL")
      .map((action) => ({
        actionId: action.id,
        loanId: action.loanId,
        amountBaseUnits: action.amountBaseUnits ?? 0n,
        expiresAt: action.expiresAt ?? this.clock.now(),
      }));
  }
  async listRecentPayments(_borrower: BorrowerRef, since: Date) {
    return [...this.actions.values()]
      .filter(
        (action) =>
          action.status === "CONFIRMED" &&
          action.confirmedAt !== null &&
          action.confirmedAt >= since &&
          action.action !== "REQUEST_APPROVAL",
      )
      .map((action) => ({ loanId: action.loanId, at: action.confirmedAt! }));
  }
  async listRecentFailures(_borrower: BorrowerRef, since: Date) {
    return [...this.actions.values()]
      .filter(
        (action) =>
          action.status === "FAILED" &&
          (action.submittedAt ?? this.clock.now()) >= since,
      )
      .map((action) => ({
        code: action.failureCode ?? "FAILED",
        at: action.submittedAt ?? this.clock.now(),
      }));
  }
  async expireApprovals(_borrower: BorrowerRef, now: Date) {
    let expired = 0;
    for (const action of this.actions.values()) {
      if (
        action.status === "AWAITING_APPROVAL" &&
        action.expiresAt &&
        action.expiresAt < now
      ) {
        this.actions.set(action.id, { ...action, status: "EXPIRED" });
        expired += 1;
      }
    }
    return expired;
  }
  async startRun() {
    if ([...this.runs.values()].some((run) => run.status === "RUNNING")) {
      throw new ConcurrentRunError();
    }
    const id = this.id();
    this.runs.set(id, {
      id,
      status: "RUNNING",
      outcomeCode: null,
      steps: [],
      snapshot: null,
      requiresHumanApproval: false,
    });
    return { id };
  }
  async appendStep(
    runId: string,
    _borrower: BorrowerRef,
    sequence: number,
    step: AgentStep,
  ) {
    this.runs.get(runId)!.steps.push({ ...step, sequence });
  }
  async setRunSnapshot(runId: string, snapshot: unknown) {
    this.runs.get(runId)!.snapshot = snapshot;
  }
  async finishRun(
    runId: string,
    input: Parameters<RepaymentAgentRepository["finishRun"]>[1],
  ) {
    const run = this.runs.get(runId)!;
    run.status = input.status;
    run.outcomeCode = input.outcomeCode;
    run.requiresHumanApproval = input.requiresHumanApproval;
  }
  async createAction(input: CreateActionInput) {
    const action = {
      id: this.id(),
      runId: input.runId,
      loanId: input.loanId,
      action: input.action,
      amountBaseUnits: input.amountBaseUnits,
      status: input.status,
      repaymentRequestId: input.repaymentRequestId,
      chainRepaymentId: agentRepaymentIdToBytes32(input.repaymentRequestId),
      mandateNonce: input.mandateNonce,
      transactionHash: null,
      attempts: 0,
      expiresAt: input.expiresAt,
      submittedAt: null,
      borrowerMembershipId: input.borrower.borrowerMembershipId,
      confirmedAt: null,
      failureCode: null,
    };
    if (
      [...this.actions.values()].some(
        (item) => item.chainRepaymentId === action.chainRepaymentId,
      )
    ) {
      throw new Error("Duplicate repayment request id");
    }
    this.actions.set(action.id, action);
    return action;
  }
  async markSubmitted(
    actionId: string,
    transactionHash: `0x${string}`,
    at: Date,
  ) {
    const action = this.actions.get(actionId)!;
    const other = [...this.actions.values()].find(
      (item) =>
        item.id !== actionId &&
        item.borrowerMembershipId === action.borrowerMembershipId &&
        item.status === "SUBMITTED",
    );
    if (other) throw new DuplicateInFlightError();
    this.actions.set(actionId, {
      ...action,
      status: "SUBMITTED",
      transactionHash,
      submittedAt: at,
      attempts: action.attempts + 1,
    });
  }
  async markFailed(actionId: string, failureCode: string) {
    const action = this.actions.get(actionId)!;
    if (action.status === "CONFIRMED") return;
    this.actions.set(actionId, { ...action, status: "FAILED", failureCode });
  }
  async recordConfirmedRepayment(
    input: Parameters<RepaymentAgentRepository["recordConfirmedRepayment"]>[0],
  ) {
    const action = this.actions.get(input.actionId)!;
    if (action.status === "CONFIRMED") return;
    this.actions.set(input.actionId, {
      ...action,
      status: "CONFIRMED",
      confirmedAt: input.confirmedAt,
      transactionHash: input.transactionHash,
    });
    this.confirmedRepayments.push({
      loanId: input.loanId,
      amountBaseUnits: action.amountBaseUnits ?? 0n,
      transactionHash: input.transactionHash,
    });
    if (input.verification.remainingBaseUnits === 0n) {
      const loan = this.obligations.get(input.loanId)!;
      this.obligations.set(input.loanId, { ...loan, status: "REPAID" });
    }
  }
}

export class RecordingNotifier implements RepaymentNotifier {
  readonly sent: AgentNotification[] = [];
  async notify(_profile: BorrowerProfile, notification: AgentNotification) {
    this.sent.push(notification);
    return { delivered: true, code: null };
  }
}

export class StaticReconciliationHealth implements ReconciliationHealthReader {
  health: ReconciliationHealth = {
    healthy: true,
    lastSuccessfulAt: null,
    reasonCode: null,
  };
  async read() {
    return this.health;
  }
}

/** Replays fixed, possibly adversarial, planner outputs. */
export class ScriptedPlanner implements RepaymentPlanner {
  readonly kind = "MODEL" as const;
  readonly model = "scripted-eval-model";
  private index = 0;
  constructor(private readonly outputs: ReadonlyArray<unknown>) {}
  async plan({ toolbox }: PlannerRequest): Promise<PlannerResult> {
    await toolbox.call("get_repayment_context", {});
    const output = this.outputs[Math.min(this.index, this.outputs.length - 1)];
    this.index += 1;
    return { decision: output, kind: this.kind, model: this.model };
  }
}

export const BORROWER_WALLET = "0x00000000000000000000000000000000000b0b00";
export const LENDER_WALLETS = [
  "0x0000000000000000000000000000000000001e01",
  "0x0000000000000000000000000000000000001e02",
  "0x0000000000000000000000000000000000001e03",
];

export type WorldInput = Readonly<{
  balanceUsdc: number;
  obligations: ReadonlyArray<{ outstandingUsdc: number; dueInHours: number }>;
  mandate?: Partial<{
    maxPerRepaymentUsdc: number;
    maxPerPeriodUsdc: number;
    minimumReserveUsdc: number;
    earliestBeforeDueHours: number;
    expiresInHours: number;
  }> | null;
  allowanceUsdc?: number;
  planner?: RepaymentPlanner;
}>;

export const usdcUnits = (value: number) =>
  BigInt(Math.round(value * 100)) * (ONE_USDC / 100n);

export function createWorld(input: WorldInput) {
  const clock = new MutableClock(new Date("2026-10-16T09:00:00.000Z"));
  const chain = new SimulatedEscrowChain(clock);
  const borrower: BorrowerRef = {
    organizationId: "00000000-0000-4000-8000-00000000000a",
    borrowerMembershipId: "00000000-0000-4000-8000-00000000000b",
  };
  const profile: BorrowerProfile = {
    ...borrower,
    userId: "00000000-0000-4000-8000-00000000000c",
    email: "borrower@example.test",
    name: "Eval Borrower",
    walletAddress: BORROWER_WALLET,
    employmentActive: true,
  };
  const repository = new InMemoryRepaymentAgentRepository(profile, clock);
  const notifier = new RecordingNotifier();
  const reconciliation = new StaticReconciliationHealth();

  chain.setBalance(BORROWER_WALLET, usdcUnits(input.balanceUsdc));
  input.obligations.forEach((obligation, index) => {
    const chainLoanId = String(index + 1);
    const dueAt = new Date(
      clock.now().getTime() + obligation.dueInHours * HOUR_MS,
    );
    const amount = usdcUnits(obligation.outstandingUsdc);
    chain.addLoan({
      chainLoanId,
      borrower: BORROWER_WALLET,
      lender: LENDER_WALLETS[index],
      repaymentAmountBaseUnits: amount,
      dueAt,
    });
    const loanId = `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`;
    repository.obligations.set(loanId, {
      loanId,
      chainLoanId,
      contractAddress: chain.contractAddress,
      lenderWalletAddress: LENDER_WALLETS[index],
      dueAt,
      repaymentBaseUnits: amount,
      agentEligible: true,
      status: "ACTIVE",
    });
  });
  if (input.mandate !== null) {
    const mandate = input.mandate ?? {};
    chain.setMandate(BORROWER_WALLET, {
      agentAddress: chain.agentAddress,
      maxPerRepaymentBaseUnits: usdcUnits(mandate.maxPerRepaymentUsdc ?? 25),
      maxPerPeriodBaseUnits: usdcUnits(mandate.maxPerPeriodUsdc ?? 100),
      minimumReserveBaseUnits: usdcUnits(mandate.minimumReserveUsdc ?? 40),
      periodSeconds: 30 * 86_400,
      earliestBeforeDueSeconds: (mandate.earliestBeforeDueHours ?? 168) * 3_600,
      expiresAt: new Date(
        clock.now().getTime() + (mandate.expiresInHours ?? 2_160) * HOUR_MS,
      ),
    });
  }
  chain.allowances.set(
    BORROWER_WALLET.toLowerCase(),
    usdcUnits(input.allowanceUsdc ?? input.mandate?.maxPerPeriodUsdc ?? 100),
  );

  let idSequence = 0;
  const deps: RepaymentAgentDependencies = {
    repository,
    gateway: chain,
    reconciliation,
    notifier,
    planner: input.planner ?? new RuleBasedRepaymentPlanner(),
    clock,
    newId: () =>
      `00000000-0000-4000-9000-${(++idSequence).toString(16).padStart(12, "0")}`,
  };

  return {
    clock,
    chain,
    borrower,
    repository,
    notifier,
    reconciliation,
    deps,
    run: (overrides: Partial<RepaymentAgentDependencies> = {}) =>
      runRepaymentAgent(borrower, "MANUAL", { ...deps, ...overrides }),
  };
}

export type EvalWorld = ReturnType<typeof createWorld>;
