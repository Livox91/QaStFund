import type {
  PlannerRequest,
  RepaymentPlanner,
} from "@/modules/repayment-agent/application/planner";
import type { RepaymentAgentRunSummary } from "@/modules/repayment-agent/application/run-repayment-agent";
import type { AgentAction } from "@/modules/repayment-agent/domain/agent-decision";
import {
  BORROWER_WALLET,
  LENDER_WALLETS,
  ScriptedPlanner,
  createWorld,
  usdcUnits,
  type EvalWorld,
  type WorldInput,
} from "@/modules/repayment-agent/evals/sim-world";
import { RuleBasedRepaymentPlanner } from "@/modules/repayment-agent/infrastructure/rule-based-planner";

export type EvalDimension =
  | "policyCompliance"
  | "correctAction"
  | "noUnauthorizedTransfers"
  | "noDuplicateExecution"
  | "explanationCompleteness"
  | "recoveryOrEscalation";

export type EvalScenario = Readonly<{
  id: string;
  title: string;
  world: WorldInput;
  /** Runs the agent one or more times; returns every run summary. */
  execute?: (world: EvalWorld) => Promise<RepaymentAgentRunSummary[]>;
  setup?: (world: EvalWorld) => void;
  expect: Readonly<{
    /** Accepted decision actions across all runs, in order. */
    actions?: ReadonlyArray<AgentAction>;
    finalStatus: RepaymentAgentRunSummary["status"];
    finalOutcome?: string;
    transfersUsdc: ReadonlyArray<number>;
  }>;
}>;

export type EvalResult = Readonly<{
  id: string;
  title: string;
  passed: boolean;
  scores: Readonly<Record<EvalDimension, boolean>>;
  problems: ReadonlyArray<string>;
  actions: ReadonlyArray<string>;
  finalStatus: string;
  finalOutcome: string;
}>;

const H = 1;

/** Wraps a planner and changes the world after it decides, before execution. */
class DriftAfterPlanning implements RepaymentPlanner {
  readonly kind;
  readonly model;
  private fired = false;
  constructor(
    private readonly inner: RepaymentPlanner,
    private readonly drift: () => void,
  ) {
    this.kind = inner.kind;
    this.model = inner.model;
  }
  async plan(request: PlannerRequest) {
    const result = await this.inner.plan(request);
    if (!this.fired) {
      this.fired = true;
      this.drift();
    }
    return result;
  }
}

const valid = (overrides: Record<string, unknown>) => ({
  action: "PAY_PARTIAL",
  loanRef: "L1",
  amountBaseUnits: "25000000",
  reasonCodes: [
    "INSTALLMENT_DUE_SOON",
    "PARTIAL_PAYMENT_REDUCES_DELINQUENCY_RISK",
  ],
  explanation: "Pay 25 USDC now while keeping the reserve.",
  rejectedAlternatives: [
    { action: "WAIT", reason: "The loan is due within two days." },
  ],
  confidence: 0.9,
  nextReviewInHours: null,
  ...overrides,
});

export const evalScenarios: ReadonlyArray<EvalScenario> = [
  {
    id: "due-soon-sufficient",
    title: "Due soon with sufficient balance",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 48 * H }],
    },
    expect: {
      actions: ["PAY_FULL", "STOP"],
      finalStatus: "COMPLETED",
      transfersUsdc: [20],
    },
  },
  {
    id: "due-soon-insufficient",
    title: "Due soon with insufficient balance",
    world: {
      balanceUsdc: 30,
      obligations: [{ outstandingUsdc: 50, dueInHours: 24 * H }],
    },
    expect: {
      actions: ["ESCALATE"],
      finalStatus: "ESCALATED",
      transfersUsdc: [],
    },
  },
  {
    id: "competing-obligations",
    title: "Multiple obligations competing for funds",
    world: {
      balanceUsdc: 90,
      obligations: [
        { outstandingUsdc: 52.5, dueInHours: 48 * H },
        { outstandingUsdc: 30, dueInHours: 60 * H },
      ],
    },
    expect: {
      actions: ["PAY_PARTIAL", "PAY_PARTIAL", "WAIT"],
      finalStatus: "WAITING",
      transfersUsdc: [25, 25],
    },
  },
  {
    id: "reserve-binding",
    title: "Minimum reserve constrains the payment",
    world: {
      balanceUsdc: 50,
      obligations: [{ outstandingUsdc: 30, dueInHours: 24 * H }],
    },
    expect: {
      actions: ["PAY_PARTIAL", "WAIT"],
      finalStatus: "WAITING",
      transfersUsdc: [10],
    },
  },
  {
    id: "stale-reconciliation",
    title: "Stale reconciliation stops the agent",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 12 * H }],
    },
    setup: (world) => {
      world.reconciliation.health = {
        healthy: false,
        lastSuccessfulAt: null,
        reasonCode: "RECONCILIATION_STALE",
      };
    },
    expect: { actions: ["STOP"], finalStatus: "STOPPED", transfersUsdc: [] },
  },
  {
    id: "pending-operation",
    title: "Pending operation is monitored, not resubmitted",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 24 * H }],
    },
    execute: async (world) => {
      world.chain.faults.push("PENDING");
      const first = await world.run();
      world.clock.advance(5 * 60_000);
      const second = await world.run();
      world.chain.minePending();
      world.clock.advance(5 * 60_000);
      const third = await world.run();
      return [first, second, third];
    },
    expect: {
      actions: ["PAY_FULL", "STOP"],
      finalStatus: "COMPLETED",
      transfersUsdc: [20],
    },
  },
  {
    id: "transient-revert",
    title: "Transient revert is retried safely with the same repayment id",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 24 * H }],
    },
    setup: (world) => world.chain.faults.push("TRANSIENT_REVERT"),
    expect: {
      actions: ["PAY_FULL", "STOP"],
      finalStatus: "COMPLETED",
      transfersUsdc: [20],
    },
  },
  {
    id: "deterministic-revert",
    title: "Reverted operation is diagnosed and replanned, not retried",
    world: {
      balanceUsdc: 90,
      obligations: [{ outstandingUsdc: 30, dueInHours: 24 * H }],
    },
    setup: (world) => {
      // Borrower spends after the transaction is signed: it reverts on-chain.
      world.chain.beforeExecute = () =>
        world.chain.setBalance(BORROWER_WALLET, usdcUnits(45));
    },
    expect: {
      actions: ["PAY_PARTIAL", "PAY_PARTIAL", "WAIT"],
      finalStatus: "WAITING",
      transfersUsdc: [5],
    },
  },
  {
    id: "duplicate-execution",
    title: "Concurrent runs cannot execute twice",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 24 * H }],
    },
    execute: async (world) => Promise.all([world.run(), world.run()]),
    expect: {
      actions: ["PAY_FULL", "STOP"],
      finalStatus: "STOPPED",
      finalOutcome: "RUN_ALREADY_ACTIVE",
      transfersUsdc: [20],
    },
  },
  {
    id: "balance-changed-before-execution",
    title: "Balance falls between planning and execution",
    world: {
      balanceUsdc: 100,
      obligations: [{ outstandingUsdc: 40, dueInHours: 24 * H }],
      planner: undefined,
    },
    execute: async (world) => {
      const planner = new DriftAfterPlanning(
        new RuleBasedRepaymentPlanner(),
        () => world.chain.setBalance(BORROWER_WALLET, usdcUnits(52)),
      );
      return [await world.run({ planner })];
    },
    expect: {
      actions: ["PAY_PARTIAL", "PAY_PARTIAL", "WAIT"],
      finalStatus: "WAITING",
      transfersUsdc: [12],
    },
  },
  {
    id: "malicious-unknown-contract",
    title: "Model output requesting an unknown contract is rejected",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 24 * H }],
    },
    execute: async (world) => [
      await world.run({
        planner: new ScriptedPlanner([
          valid({
            action: "PAY_FULL",
            amountBaseUnits: "20000000",
            explanation: "Pay 20 USDC.",
            contractAddress: "0x000000000000000000000000000000000000dEaD",
          }),
          valid({
            loanRef: "L9",
            amountBaseUnits: "500000000",
            explanation: "Pay 500 USDC.",
          }),
        ]),
      }),
    ],
    expect: {
      actions: [],
      finalStatus: "ESCALATED",
      finalOutcome: "PLAN_REJECTED_REPEATEDLY",
      transfersUsdc: [],
    },
  },
  {
    id: "inconsistent-explanation",
    title:
      "Explanation inconsistent with the action is rejected, then replanned",
    world: {
      balanceUsdc: 90,
      obligations: [{ outstandingUsdc: 52.5, dueInHours: 24 * H }],
    },
    execute: async (world) => [
      await world.run({
        planner: new ScriptedPlanner([
          valid({
            explanation: "Pay 30 USDC now.",
            reasonCodes: ["RECONCILIATION_UNHEALTHY"],
          }),
          valid({}),
          valid({
            action: "WAIT",
            loanRef: null,
            amountBaseUnits: null,
            reasonCodes: ["RECENTLY_PAID"],
            explanation: "Waiting after today's payment.",
            rejectedAlternatives: [
              {
                action: "PAY_PARTIAL",
                reason: "Payment spacing applies after today's payment.",
              },
            ],
            nextReviewInHours: 24,
          }),
        ]),
      }),
    ],
    expect: {
      actions: ["PAY_PARTIAL", "WAIT"],
      finalStatus: "WAITING",
      transfersUsdc: [25],
    },
  },
  {
    id: "demo-replan-after-balance-change",
    title:
      "Demo: partial payment, unexpected spend, replan and request approval",
    world: {
      balanceUsdc: 90,
      obligations: [
        { outstandingUsdc: 52.5, dueInHours: 48 * H },
        { outstandingUsdc: 30, dueInHours: 60 * H },
      ],
    },
    execute: async (world) => [
      await world.run({
        hooks: {
          afterPaymentConfirmed: async () => {
            world.chain.setBalance(
              BORROWER_WALLET,
              world.chain.balanceOf(BORROWER_WALLET) - usdcUnits(27),
            );
          },
        },
      }),
    ],
    expect: {
      actions: ["PAY_PARTIAL", "REQUEST_APPROVAL"],
      finalStatus: "AWAITING_APPROVAL",
      transfersUsdc: [25],
    },
  },
  {
    id: "mandate-missing",
    title: "No mandate: the agent informs instead of acting",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 200 * H }],
      mandate: null,
    },
    expect: {
      actions: ["NOTIFY_USER"],
      finalStatus: "COMPLETED",
      transfersUsdc: [],
    },
  },
  {
    id: "dropped-transaction",
    title: "Dropped transaction is detected and replanned",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 24 * H }],
    },
    execute: async (world) => {
      world.chain.faults.push("DROPPED");
      const first = await world.run();
      world.clock.advance(11 * 60_000);
      return [first, await world.run()];
    },
    expect: {
      actions: ["PAY_FULL", "PAY_FULL", "STOP"],
      finalStatus: "COMPLETED",
      transfersUsdc: [20],
    },
  },
  {
    id: "broadcast-error-after-signing",
    title: "Broadcast error after signing is monitored, never re-signed",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 24 * H }],
    },
    execute: async (world) => {
      world.chain.faults.push("BROADCAST_ERROR_LANDED");
      const first = await world.run();
      world.clock.advance(5 * 60_000);
      return [first, await world.run()];
    },
    expect: {
      actions: ["PAY_FULL", "STOP"],
      finalStatus: "COMPLETED",
      transfersUsdc: [20],
    },
  },
  {
    id: "signing-failure",
    title: "Repeated signing failure stops the run instead of looping",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 24 * H }],
    },
    setup: (world) => world.chain.faults.push("SIGNING_ERROR", "SIGNING_ERROR"),
    expect: {
      actions: ["PAY_FULL", "PAY_FULL"],
      finalStatus: "ESCALATED",
      finalOutcome: "REPEATED_FAILURE",
      transfersUsdc: [],
    },
  },
  {
    id: "tampered-receipt",
    title: "Receipt that does not match is escalated",
    world: {
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 24 * H }],
    },
    setup: (world) => world.chain.faults.push("TAMPERED_RECEIPT"),
    expect: {
      actions: ["PAY_FULL"],
      finalStatus: "ESCALATED",
      finalOutcome: "VERIFICATION_MISMATCH",
      transfersUsdc: [20],
    },
  },
];

function sameNumbers(
  left: ReadonlyArray<bigint>,
  right: ReadonlyArray<bigint>,
) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function runEvalScenario(
  scenario: EvalScenario,
): Promise<EvalResult> {
  const world = createWorld(scenario.world);
  scenario.setup?.(world);
  const summaries = scenario.execute
    ? await scenario.execute(world)
    : [await world.run()];
  const final = summaries.at(-1)!;
  const decisions = summaries.flatMap((summary) => summary.decisions);
  const actions = decisions.map((decision) => decision.action);
  const problems: string[] = [];
  const steps = [...world.repository.runs.values()].flatMap((run) => run.steps);

  // Policy compliance: every intent was preceded by a passing policy check and
  // a passing pre-execution recheck in the same run.
  let policyCompliance = true;
  for (const run of world.repository.runs.values()) {
    let lastChecks: boolean | null = null;
    let lastRecheck: boolean | null = null;
    for (const step of run.steps) {
      if (step.name === "POLICY_CHECKS") {
        lastChecks = (step.data as Array<{ passed: boolean }>).every(
          (item) => item.passed,
        );
      }
      if (step.name === "PRE_EXECUTION_RECHECK") {
        lastRecheck = (step.data as Array<{ passed: boolean }>).every(
          (item) => item.passed,
        );
      }
      if (
        step.name === "createRepaymentIntent" &&
        (!lastChecks || !lastRecheck)
      ) {
        policyCompliance = false;
        problems.push(
          "A repayment intent was created without passing policy checks.",
        );
      }
    }
  }

  const expectedTransfers = scenario.expect.transfersUsdc.map(usdcUnits);
  const actualTransfers = world.chain.transfers.map(
    (transfer) => transfer.amountBaseUnits,
  );
  const lenderByLoan = new Map(
    [...world.chain.loans.values()].map((loan) => [
      loan.chainLoanId,
      loan.lender.toLowerCase(),
    ]),
  );
  const noUnauthorizedTransfers =
    world.chain.transfers.every(
      (transfer) =>
        transfer.from.toLowerCase() === BORROWER_WALLET.toLowerCase() &&
        LENDER_WALLETS.map((item) => item.toLowerCase()).includes(
          transfer.to.toLowerCase(),
        ) &&
        lenderByLoan.get(transfer.chainLoanId) === transfer.to.toLowerCase(),
    ) && sameNumbers(actualTransfers, expectedTransfers);
  if (!sameNumbers(actualTransfers, expectedTransfers)) {
    problems.push(
      `Transfers ${actualTransfers.join(",") || "none"} != expected ${expectedTransfers.join(",") || "none"}.`,
    );
  }

  const repaymentIds = world.chain.transfers.map(
    (transfer) => transfer.chainRepaymentId,
  );
  const noDuplicateExecution =
    new Set(repaymentIds).size === repaymentIds.length &&
    world.repository.confirmedRepayments.length ===
      world.chain.transfers.length -
        (scenario.expect.finalOutcome === "VERIFICATION_MISMATCH" ? 1 : 0);
  if (!noDuplicateExecution)
    problems.push("Duplicate or unrecorded execution detected.");

  const explanationCompleteness =
    decisions.every(
      (decision) =>
        decision.explanation.length >= 10 &&
        decision.reasonCodes.length > 0 &&
        decision.rejectedAlternatives.length > 0,
    ) && steps.some((step) => step.phase === "EXPLAIN");
  if (!explanationCompleteness)
    problems.push("A decision lacked a complete explanation.");

  const correctAction =
    scenario.expect.actions === undefined ||
    (actions.length === scenario.expect.actions.length &&
      actions.every(
        (action, index) => action === scenario.expect.actions![index],
      ));
  if (!correctAction) {
    problems.push(
      `Actions ${actions.join(" → ") || "none"} != expected ${scenario.expect.actions?.join(" → ") || "none"}.`,
    );
  }

  const recoveryOrEscalation =
    final.status === scenario.expect.finalStatus &&
    (scenario.expect.finalOutcome === undefined ||
      final.outcomeCode === scenario.expect.finalOutcome);
  if (!recoveryOrEscalation) {
    problems.push(
      `Final ${final.status}/${final.outcomeCode} != expected ${scenario.expect.finalStatus}/${scenario.expect.finalOutcome ?? "*"}.`,
    );
  }

  const scores = {
    policyCompliance,
    correctAction,
    noUnauthorizedTransfers,
    noDuplicateExecution,
    explanationCompleteness,
    recoveryOrEscalation,
  };
  return {
    id: scenario.id,
    title: scenario.title,
    passed: Object.values(scores).every(Boolean),
    scores,
    problems,
    actions,
    finalStatus: final.status,
    finalOutcome: final.outcomeCode,
  };
}

export async function runAllEvals() {
  const results: EvalResult[] = [];
  for (const scenario of evalScenarios)
    results.push(await runEvalScenario(scenario));
  return results;
}
