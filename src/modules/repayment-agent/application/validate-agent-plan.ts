import {
  AMOUNT_ACTIONS,
  PAYMENT_ACTIONS,
  REASON_SUPPORTS,
  agentDecisionSchema,
  type AgentAction,
  type AgentDecision,
} from "@/modules/repayment-agent/domain/agent-decision";
import {
  DEFAULT_AGENT_POLICY,
  computeRepaymentCapacity,
  isCentAligned,
  isMandateUsable,
  roundDownToCent,
  type AgentPolicyConfig,
  type ObligationView,
  type RepaymentCapacity,
} from "@/modules/repayment-agent/domain/agent-policy";
import type {
  PolicyCheck,
  RepaymentObservation,
} from "@/modules/repayment-agent/domain/agent-run";
import { formatUsdc, parseUsdc } from "@/shared/money/usdc";

export type AvailableAction = Readonly<{
  action: AgentAction;
  loanRef: string | null;
  minAmountBaseUnits: bigint | null;
  maxAmountBaseUnits: bigint | null;
  note: string;
}>;

type Context = Readonly<{
  observation: RepaymentObservation;
  agentAddress: string;
  policy?: AgentPolicyConfig;
}>;

function capacityFor(context: Context, obligation: ObligationView) {
  const { observation, agentAddress } = context;
  if (
    !isMandateUsable(observation.mandate, agentAddress, observation.observedAt)
  ) {
    return null;
  }
  return computeRepaymentCapacity({
    mandate: observation.mandate,
    obligation,
    walletBalanceBaseUnits: observation.walletBalanceBaseUnits,
    allowanceBaseUnits: observation.allowanceBaseUnits,
    now: observation.observedAt,
  });
}

/** The agent made a confirmed payment on this loan inside the spacing window. */
export function recentlyPaid(
  observation: RepaymentObservation,
  loanId: string,
) {
  return observation.recentPayments.some(
    (payment) => payment.loanId === loanId,
  );
}

function minBigInt(...values: bigint[]) {
  return values.reduce((smallest, value) =>
    value < smallest ? value : smallest,
  );
}

/**
 * The menu the planner chooses from. Everything outside it is rejected by
 * `validateAgentDecision`, which re-derives the same bounds independently.
 */
export function computeAvailableActions(context: Context): AvailableAction[] {
  const policy = context.policy ?? DEFAULT_AGENT_POLICY;
  const { observation } = context;
  const actions: AvailableAction[] = [
    {
      action: "WAIT",
      loanRef: null,
      minAmountBaseUnits: null,
      maxAmountBaseUnits: null,
      note: "Re-evaluate later; requires nextReviewInHours.",
    },
    {
      action: "NOTIFY_USER",
      loanRef: null,
      minAmountBaseUnits: null,
      maxAmountBaseUnits: null,
      note: "Send the borrower an informational notice.",
    },
    {
      action: "ESCALATE",
      loanRef: null,
      minAmountBaseUnits: null,
      maxAmountBaseUnits: null,
      note: "Stop and hand the situation to the borrower for human action.",
    },
    {
      action: "STOP",
      loanRef: null,
      minAmountBaseUnits: null,
      maxAmountBaseUnits: null,
      note: "Take no action in this run.",
    },
  ];
  if (!observation.reconciliation.healthy || observation.inFlight) {
    return actions;
  }

  for (const obligation of observation.obligations) {
    if (!obligation.agentEligible || obligation.outstandingBaseUnits <= 0n) {
      continue;
    }
    const spaced = recentlyPaid(observation, obligation.loanId);
    const capacity = spaced ? null : capacityFor(context, obligation);
    const payable = capacity?.payableNowBaseUnits ?? 0n;
    if (capacity && payable >= obligation.outstandingBaseUnits) {
      actions.push({
        action: "PAY_FULL",
        loanRef: obligation.ref,
        minAmountBaseUnits: obligation.outstandingBaseUnits,
        maxAmountBaseUnits: obligation.outstandingBaseUnits,
        note: "Pays the full remaining balance inside the mandate.",
      });
    }
    const partialMax = roundDownToCent(
      minBigInt(payable, obligation.outstandingBaseUnits - 1n),
    );
    if (capacity && partialMax >= policy.minimumPartialBaseUnits) {
      actions.push({
        action: "PAY_PARTIAL",
        loanRef: obligation.ref,
        minAmountBaseUnits: policy.minimumPartialBaseUnits,
        maxAmountBaseUnits: partialMax,
        note: `Whole-cent amount; binding limit is ${capacity.bindingConstraint}.`,
      });
    }
    const hasPendingApproval = observation.pendingApprovals.some(
      (approval) => approval.loanId === obligation.loanId,
    );
    const approvalMax = minBigInt(
      obligation.outstandingBaseUnits,
      observation.walletBalanceBaseUnits,
    );
    if (!hasPendingApproval && approvalMax > payable) {
      actions.push({
        action: "REQUEST_APPROVAL",
        loanRef: obligation.ref,
        minAmountBaseUnits: payable + 1n,
        maxAmountBaseUnits: approvalMax,
        note: "Ask the borrower to approve an amount above the mandate with their passkey.",
      });
    }
  }
  return actions;
}

export type ValidationResult = Readonly<{
  valid: boolean;
  checks: ReadonlyArray<PolicyCheck>;
  decision: AgentDecision | null;
  obligation: ObligationView | null;
  amountBaseUnits: bigint | null;
  capacity: RepaymentCapacity | null;
}>;

/** Every amount written in the explanation, in USDC base units. */
export function amountsMentioned(explanation: string): bigint[] {
  const amounts: bigint[] = [];
  for (const match of explanation.matchAll(
    /\d{1,3}(?:,\d{3})+(?:\.\d{1,6})?|\d+(?:\.\d{1,6})?/g,
  )) {
    try {
      amounts.push(parseUsdc(match[0].replaceAll(",", "")));
    } catch {
      // Not an amount (for example a date fragment).
    }
  }
  return amounts;
}

/**
 * Independent, deterministic check of planner output. The model chooses; this
 * function decides whether the choice may execute.
 */
export function validateAgentDecision(
  raw: unknown,
  context: Context,
): ValidationResult {
  const policy = context.policy ?? DEFAULT_AGENT_POLICY;
  const { observation } = context;
  const checks: PolicyCheck[] = [];
  const check = (code: string, passed: boolean, detail: string) => {
    checks.push({ code, passed, detail });
    return passed;
  };
  const result = (
    decision: AgentDecision | null,
    obligation: ObligationView | null = null,
    amountBaseUnits: bigint | null = null,
    capacity: RepaymentCapacity | null = null,
  ): ValidationResult => ({
    valid: checks.every((item) => item.passed),
    checks,
    decision,
    obligation,
    amountBaseUnits,
    capacity,
  });

  const parsed = agentDecisionSchema.safeParse(raw);
  if (
    !check(
      "SCHEMA_VALID",
      parsed.success,
      parsed.success
        ? "Decision matches the strict schema; no free-form transaction fields."
        : `Rejected: ${parsed.error.issues
            .slice(0, 3)
            .map(
              (issue) => `${issue.path.join(".") || "root"} ${issue.message}`,
            )
            .join("; ")}`,
    )
  ) {
    return result(null);
  }
  const decision = parsed.data as AgentDecision;
  const isPayment = PAYMENT_ACTIONS.has(decision.action);
  const needsAmount = AMOUNT_ACTIONS.has(decision.action);

  const unsupported = decision.reasonCodes.filter(
    (code) =>
      !(REASON_SUPPORTS[code] as ReadonlyArray<AgentAction>).includes(
        decision.action,
      ),
  );
  check(
    "REASONS_SUPPORT_ACTION",
    unsupported.length === 0,
    unsupported.length === 0
      ? "Every reason code supports the selected action."
      : `Reason codes ${unsupported.join(", ")} do not support ${decision.action}.`,
  );
  const alternativeActions = decision.rejectedAlternatives.map(
    (item) => item.action,
  );
  check(
    "ALTERNATIVES_DISTINCT",
    !alternativeActions.includes(decision.action) &&
      new Set(alternativeActions).size === alternativeActions.length,
    "Rejected alternatives must differ from the selected action and from each other.",
  );
  if (decision.action === "WAIT") {
    check(
      "WAIT_HAS_REVIEW_TIME",
      decision.nextReviewInHours !== null,
      "WAIT must say when the agent will re-evaluate.",
    );
  }

  if (!needsAmount) {
    check(
      "NO_AMOUNT_FOR_NON_PAYMENT",
      decision.amountBaseUnits === null,
      "Only payment and approval actions may carry an amount.",
    );
    const available = computeAvailableActions(context).some(
      (item) => item.action === decision.action,
    );
    check("ACTION_AVAILABLE", available, `${decision.action} is permitted.`);
    return result(decision);
  }

  const obligation =
    observation.obligations.find((item) => item.ref === decision.loanRef) ??
    null;
  if (!obligation) {
    check(
      "LOAN_REFERENCE_OWNED",
      false,
      `Unknown loan reference ${decision.loanRef ?? "null"}.`,
    );
    return result(decision);
  }
  check(
    "LOAN_REFERENCE_OWNED",
    true,
    `${decision.loanRef} is one of the borrower's own active loans.`,
  );
  check(
    "CONTRACT_ALLOWLISTED",
    obligation.agentEligible,
    obligation.agentEligible
      ? "Loan is held by the configured mandate-capable escrow."
      : "Loan is not on the mandate-capable escrow; the agent cannot act on it.",
  );
  check(
    "RECONCILIATION_HEALTHY",
    observation.reconciliation.healthy,
    observation.reconciliation.healthy
      ? "Chain reconciliation is current."
      : `Reconciliation unhealthy (${observation.reconciliation.reasonCode ?? "unknown"}).`,
  );
  check(
    "NO_OPERATION_IN_FLIGHT",
    observation.inFlight === null,
    observation.inFlight
      ? "An earlier repayment is still in flight; it must be monitored, not duplicated."
      : "No repayment is in flight.",
  );

  const amount =
    decision.amountBaseUnits === null ? null : BigInt(decision.amountBaseUnits);
  if (
    !check(
      "AMOUNT_PRESENT",
      amount !== null && amount > 0n,
      `${decision.action} requires a positive amount.`,
    ) ||
    amount === null
  ) {
    return result(decision, obligation);
  }
  check(
    "AMOUNT_WITHIN_OUTSTANDING",
    amount <= obligation.outstandingBaseUnits,
    `${formatUsdc(amount)} of ${formatUsdc(obligation.outstandingBaseUnits)} USDC outstanding.`,
  );
  if (decision.action === "PAY_FULL") {
    check(
      "FULL_MATCHES_OUTSTANDING",
      amount === obligation.outstandingBaseUnits,
      "PAY_FULL must pay exactly the remaining balance.",
    );
  } else {
    check(
      "AMOUNT_CENT_ALIGNED",
      isCentAligned(amount) || amount === obligation.outstandingBaseUnits,
      "Partial amounts must be whole cents.",
    );
  }
  if (decision.action === "PAY_PARTIAL") {
    check(
      "PARTIAL_BELOW_OUTSTANDING",
      amount < obligation.outstandingBaseUnits,
      "PAY_PARTIAL must leave a balance; use PAY_FULL to close the loan.",
    );
    check(
      "PARTIAL_ABOVE_MINIMUM",
      amount >= policy.minimumPartialBaseUnits,
      `Partial repayments must be at least ${formatUsdc(policy.minimumPartialBaseUnits)} USDC.`,
    );
  }

  const mentioned = amountsMentioned(decision.explanation);
  check(
    "EXPLANATION_STATES_AMOUNT",
    mentioned.includes(amount),
    mentioned.includes(amount)
      ? `Explanation states ${formatUsdc(amount)} USDC.`
      : `Explanation does not state the selected amount (${formatUsdc(amount)} USDC).`,
  );

  const capacity = capacityFor(context, obligation);
  if (isPayment) {
    const mandate = observation.mandate;
    check(
      "MANDATE_USABLE",
      capacity !== null,
      capacity
        ? `Mandate nonce ${mandate?.nonce.toString()} is active for this agent.`
        : "No active, unexpired mandate names this agent.",
    );
    check(
      "PAYMENT_SPACING",
      !recentlyPaid(observation, obligation.loanId),
      recentlyPaid(observation, obligation.loanId)
        ? "The agent already paid this loan inside the spacing window."
        : "No recent agent payment on this loan.",
    );
    if (capacity) {
      check(
        "WITHIN_PER_REPAYMENT_CAP",
        amount <= capacity.limits.PER_REPAYMENT_CAP,
        `Cap ${formatUsdc(capacity.limits.PER_REPAYMENT_CAP)} USDC per repayment.`,
      );
      check(
        "WITHIN_PERIOD_CAP",
        amount <= capacity.limits.PERIOD_CAP,
        `${formatUsdc(capacity.limits.PERIOD_CAP)} USDC left in this period.`,
      );
      check(
        "RESERVE_PRESERVED",
        amount <= capacity.limits.RESERVE,
        `Balance ${formatUsdc(observation.walletBalanceBaseUnits)} USDC must stay at or above the ${formatUsdc(mandate?.minimumReserveBaseUnits ?? 0n)} USDC reserve.`,
      );
      check(
        "ALLOWANCE_SUFFICIENT",
        amount <= capacity.limits.ALLOWANCE,
        `Escrow allowance ${formatUsdc(capacity.limits.ALLOWANCE)} USDC.`,
      );
      check(
        "REPAYMENT_WINDOW_OPEN",
        capacity.windowOpen,
        capacity.windowOpen
          ? "Inside the mandate's repayment window."
          : `Window opens ${capacity.windowOpensAt?.toISOString()}.`,
      );
    }
  } else {
    const payable = capacity?.payableNowBaseUnits ?? 0n;
    check(
      "APPROVAL_OUTSIDE_MANDATE",
      amount > payable,
      amount > payable
        ? "Amount exceeds what the mandate allows, so passkey approval is required."
        : "Amount fits the mandate; the agent should pay rather than ask.",
    );
    check(
      "APPROVAL_WITHIN_BALANCE",
      amount <= observation.walletBalanceBaseUnits,
      "Approval requests cannot exceed the wallet balance.",
    );
    check(
      "NO_DUPLICATE_APPROVAL",
      !observation.pendingApprovals.some(
        (approval) => approval.loanId === obligation.loanId,
      ),
      "Only one open approval request per loan.",
    );
  }
  return result(decision, obligation, amount, capacity);
}
