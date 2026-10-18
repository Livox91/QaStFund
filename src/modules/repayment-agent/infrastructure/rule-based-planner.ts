import type {
  PlannerRequest,
  PlannerResult,
  RepaymentPlanner,
} from "@/modules/repayment-agent/application/planner";
import {
  computeAvailableActions,
  recentlyPaid,
} from "@/modules/repayment-agent/application/validate-agent-plan";
import type {
  AgentAction,
  AgentReasonCode,
  RejectedAlternative,
} from "@/modules/repayment-agent/domain/agent-decision";
import {
  DEFAULT_AGENT_POLICY,
  computeRepaymentCapacity,
  isMandateUsable,
  type AgentPolicyConfig,
  type MandateCheckedConstraint,
} from "@/modules/repayment-agent/domain/agent-policy";
import { formatUsdc } from "@/shared/money/usdc";

const usdc = (value: bigint) => `${formatUsdc(value)} USDC`;

const BINDING_REASON: Record<MandateCheckedConstraint, AgentReasonCode> = {
  OUTSTANDING: "PARTIAL_PAYMENT_REDUCES_DELINQUENCY_RISK",
  PER_REPAYMENT_CAP: "PER_REPAYMENT_CAP_BINDING",
  PERIOD_CAP: "PERIOD_CAP_BINDING",
  RESERVE: "BALANCE_BELOW_RESERVE",
  ALLOWANCE: "ALLOWANCE_INSUFFICIENT",
};

const BINDING_TEXT: Record<MandateCheckedConstraint, string> = {
  OUTSTANDING: "the remaining balance",
  PER_REPAYMENT_CAP: "the per-repayment cap",
  PERIOD_CAP: "the period spending cap",
  RESERVE: "the minimum wallet reserve",
  ALLOWANCE: "the approved escrow allowance",
};

function decision(input: {
  action: AgentAction;
  loanRef?: string | null;
  amount?: bigint | null;
  reasons: AgentReasonCode[];
  explanation: string;
  rejected: RejectedAlternative[];
  confidence?: number;
  nextReviewInHours?: number | null;
}) {
  return {
    action: input.action,
    loanRef: input.loanRef ?? null,
    amountBaseUnits: input.amount ? input.amount.toString() : null,
    reasonCodes: [...new Set(input.reasons)].slice(0, 6),
    explanation: input.explanation,
    rejectedAlternatives: input.rejected,
    confidence: input.confidence ?? 1,
    nextReviewInHours: input.nextReviewInHours ?? null,
  };
}

/**
 * Deterministic baseline planner. Used when no model is configured, when the
 * model fails, and as the reference policy in agent evaluations.
 */
export class RuleBasedRepaymentPlanner implements RepaymentPlanner {
  readonly kind = "RULES" as const;
  readonly model = null;

  constructor(
    private readonly policy: AgentPolicyConfig = DEFAULT_AGENT_POLICY,
  ) {}

  async plan({ toolbox, history }: PlannerRequest): Promise<PlannerResult> {
    await toolbox.call("get_repayment_context", {});
    await toolbox.call("list_outstanding_installments", {});
    const observation = toolbox.observation();
    const now = observation.observedAt;
    const agentAddress = toolbox.agentAddress;
    const available = computeAvailableActions({
      observation,
      agentAddress,
      policy: this.policy,
    });
    const historyReasons: AgentReasonCode[] = history.some(
      (entry) => entry.outcome === "UNEXPECTED_BALANCE_CHANGE",
    )
      ? ["UNEXPECTED_BALANCE_CHANGE"]
      : [];
    const result = (body: ReturnType<typeof decision>): PlannerResult => ({
      decision: body,
      kind: this.kind,
      model: null,
    });

    if (!observation.reconciliation.healthy) {
      return result(
        decision({
          action: "STOP",
          reasons: ["RECONCILIATION_UNHEALTHY"],
          explanation:
            "Stopping: chain reconciliation is stale, so balances cannot be trusted for a payment.",
          rejected: [
            {
              action: "PAY_PARTIAL",
              reason:
                "Paying against unreconciled records risks double counting.",
            },
            {
              action: "WAIT",
              reason:
                "Stopping surfaces the problem instead of silently deferring.",
            },
          ],
        }),
      );
    }
    if (observation.inFlight) {
      return result(
        decision({
          action: "WAIT",
          reasons: ["OPERATION_IN_FLIGHT"],
          explanation:
            "Waiting: an earlier repayment is still being confirmed; it will be monitored, not resubmitted.",
          rejected: [
            {
              action: "PAY_PARTIAL",
              reason:
                "A second payment beside an unconfirmed one could pay twice.",
            },
          ],
          nextReviewInHours: 1,
        }),
      );
    }

    const outstanding = [...observation.obligations]
      .filter((item) => item.outstandingBaseUnits > 0n)
      .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime());
    if (outstanding.length === 0) {
      return result(
        decision({
          action: "STOP",
          reasons: ["NO_OUTSTANDING_OBLIGATIONS"],
          explanation:
            "Nothing to do: there are no outstanding QastFund obligations.",
          rejected: [
            { action: "WAIT", reason: "No future obligation needs review." },
          ],
        }),
      );
    }

    // Loans on an earlier escrow (no mandate support) are visible but never
    // payable by the agent; say so instead of implying they were paid.
    if (!outstanding.some((item) => item.agentEligible)) {
      return result(
        decision({
          action: "STOP",
          reasons: ["NO_OUTSTANDING_OBLIGATIONS"],
          explanation:
            "Nothing the agent can repay: your outstanding loans are on an earlier escrow contract without mandate support, so repay them from the Loans page.",
          rejected: [
            {
              action: "WAIT",
              reason:
                "Waiting would not make these loans payable by the agent.",
            },
          ],
        }),
      );
    }

    const awaiting = new Set(
      observation.pendingApprovals.map((approval) => approval.loanId),
    );
    const target = outstanding.find(
      (item) =>
        item.agentEligible &&
        !awaiting.has(item.loanId) &&
        !recentlyPaid(observation, item.loanId),
    );
    if (!target) {
      const awaitingApproval = outstanding.some((item) =>
        awaiting.has(item.loanId),
      );
      return result(
        decision({
          action: "WAIT",
          reasons: [
            awaitingApproval ? "AWAITING_EXISTING_APPROVAL" : "RECENTLY_PAID",
            ...historyReasons,
          ],
          explanation: awaitingApproval
            ? "Waiting for the borrower to answer the open approval request before acting again."
            : "Waiting: every outstanding loan received an agent payment recently; the next review spaces payments out.",
          rejected: [
            {
              action: "PAY_PARTIAL",
              reason:
                "Another payment now would bypass the payment spacing policy.",
            },
          ],
          nextReviewInHours: 6,
        }),
      );
    }

    const competing: AgentReasonCode[] =
      outstanding.length > 1
        ? ["MULTIPLE_OBLIGATIONS_COMPETING", "EARLIER_DUE_PRIORITIZED"]
        : [];
    const msUntilDue = target.dueAt.getTime() - now.getTime();
    const overdue = msUntilDue < 0;
    const dueSoon = !overdue && msUntilDue <= this.policy.dueSoonMs;
    const urgency: AgentReasonCode[] = overdue
      ? ["INSTALLMENT_OVERDUE"]
      : dueSoon
        ? ["INSTALLMENT_DUE_SOON"]
        : [];
    const dueText = overdue
      ? "is overdue"
      : `is due in ${Math.max(1, Math.round(msUntilDue / 3_600_000))} hours`;
    const usable = isMandateUsable(observation.mandate, agentAddress, now);
    const capacity = usable
      ? computeRepaymentCapacity({
          mandate: observation.mandate!,
          obligation: target,
          walletBalanceBaseUnits: observation.walletBalanceBaseUnits,
          allowanceBaseUnits: observation.allowanceBaseUnits,
          now,
        })
      : null;
    const find = (action: AgentAction) =>
      available.find(
        (item) => item.action === action && item.loanRef === target.ref,
      );
    const payFull = find("PAY_FULL");
    const payPartial = find("PAY_PARTIAL");
    const approval = find("REQUEST_APPROVAL");

    if (payFull) {
      return result(
        decision({
          action: "PAY_FULL",
          loanRef: target.ref,
          amount: target.outstandingBaseUnits,
          reasons: [
            "FULL_PAYMENT_CLOSES_LOAN",
            "PAYMENT_WITHIN_MANDATE",
            "BALANCE_ABOVE_RESERVE",
            ...urgency,
            ...competing,
            ...historyReasons,
          ],
          explanation: `Pay ${usdc(target.outstandingBaseUnits)} now to close ${target.ref}, which ${dueText}; the wallet stays above the reserve.`,
          rejected: [
            {
              action: "PAY_PARTIAL",
              reason: "Would leave a balance the mandate can already clear.",
            },
            {
              action: "WAIT",
              reason:
                "Delaying adds delinquency risk with no liquidity benefit.",
            },
          ],
        }),
      );
    }

    if (payPartial && capacity && (dueSoon || overdue)) {
      const amount = payPartial.maxAmountBaseUnits!;
      return result(
        decision({
          action: "PAY_PARTIAL",
          loanRef: target.ref,
          amount,
          reasons: [
            "PARTIAL_PAYMENT_REDUCES_DELINQUENCY_RISK",
            BINDING_REASON[capacity.bindingConstraint],
            ...urgency,
            ...competing,
            ...historyReasons,
          ],
          explanation: `Pay ${usdc(amount)} on ${target.ref} today because it ${dueText}; a larger payment would break ${BINDING_TEXT[capacity.bindingConstraint]}.`,
          rejected: [
            {
              action: "PAY_FULL",
              reason: `The full ${usdc(target.outstandingBaseUnits)} would exceed ${BINDING_TEXT[capacity.bindingConstraint]}.`,
            },
            {
              action: "WAIT",
              reason: `${target.ref} ${dueText}; waiting increases delinquency risk.`,
            },
          ],
          confidence: 0.9,
        }),
      );
    }

    if (capacity && !capacity.windowOpen && !overdue) {
      const hours = Math.max(
        1,
        Math.min(
          168,
          Math.ceil(
            ((capacity.windowOpensAt?.getTime() ?? now.getTime()) -
              now.getTime()) /
              3_600_000,
          ),
        ),
      );
      return result(
        decision({
          action: "WAIT",
          reasons: ["NOT_YET_IN_REPAYMENT_WINDOW", ...competing],
          explanation: `Waiting: the mandate lets the agent act on ${target.ref} only closer to its due date, in about ${hours} hours.`,
          rejected: [
            {
              action: "PAY_PARTIAL",
              reason: "The mandate's repayment window is not open yet.",
            },
          ],
          nextReviewInHours: hours,
        }),
      );
    }

    if (dueSoon || overdue) {
      if (
        approval &&
        observation.walletBalanceBaseUnits >= target.outstandingBaseUnits
      ) {
        const amount = target.outstandingBaseUnits;
        const limit = capacity
          ? BINDING_REASON[capacity.bindingConstraint]
          : "MANDATE_MISSING_OR_INACTIVE";
        return result(
          decision({
            action: "REQUEST_APPROVAL",
            loanRef: target.ref,
            amount,
            reasons: [
              "HUMAN_APPROVAL_REQUIRED",
              ...urgency,
              ...(limit === "PARTIAL_PAYMENT_REDUCES_DELINQUENCY_RISK"
                ? []
                : [limit]),
              ...historyReasons,
            ] as AgentReasonCode[],
            explanation: `${target.ref} ${dueText} and needs ${usdc(amount)}, which is outside the agent's mandate; asking the borrower to approve it with their passkey.`,
            rejected: [
              {
                action: "PAY_PARTIAL",
                reason: "No partial amount fits the mandate right now.",
              },
              {
                action: "WAIT",
                reason: `${target.ref} ${dueText}; silence risks a missed payment.`,
              },
            ],
            confidence: 0.85,
          }),
        );
      }
      return result(
        decision({
          action: "ESCALATE",
          reasons: ["INSUFFICIENT_FUNDS", ...urgency, ...historyReasons],
          explanation: `${target.ref} ${dueText} but the wallet holds ${usdc(observation.walletBalanceBaseUnits)}, less than the ${usdc(target.outstandingBaseUnits)} owed; the borrower must add funds or arrange a plan.`,
          rejected: [
            {
              action: "REQUEST_APPROVAL",
              reason: "The wallet cannot cover the balance even with approval.",
            },
            {
              action: "WAIT",
              reason: "The due date is too close to wait silently.",
            },
          ],
          confidence: 0.9,
        }),
      );
    }

    if (!usable) {
      return result(
        decision({
          action: "NOTIFY_USER",
          reasons: ["MANDATE_MISSING_OR_INACTIVE"],
          explanation: `No active repayment mandate covers ${target.ref}; set one up so the agent can repay within your limits.`,
          rejected: [
            {
              action: "WAIT",
              reason:
                "The borrower should know before the due date approaches.",
            },
          ],
        }),
      );
    }
    return result(
      decision({
        action: "WAIT",
        reasons: [
          capacity?.bindingConstraint === "PERIOD_CAP"
            ? "PERIOD_CAP_BINDING"
            : "NOT_YET_IN_REPAYMENT_WINDOW",
          ...competing,
        ],
        explanation: `Waiting: ${target.ref} ${dueText} and nothing needs paying yet.`,
        rejected: [
          {
            action: "PAY_PARTIAL",
            reason:
              "Paying early would reduce liquidity without lowering risk.",
          },
        ],
        nextReviewInHours: 24,
      }),
    );
  }
}
