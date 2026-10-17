import type {
  ReconciliationHealthReader,
  RepaymentChainGateway,
} from "@/modules/repayment-agent/application/ports";
import {
  computeAvailableActions,
  validateAgentDecision,
} from "@/modules/repayment-agent/application/validate-agent-plan";
import {
  AGENT_ACTIONS,
  PAYMENT_ACTIONS,
  type AgentAction,
} from "@/modules/repayment-agent/domain/agent-decision";
import {
  DEFAULT_AGENT_POLICY,
  computeRepaymentCapacity,
  hoursUntil,
  isMandateUsable,
  type AgentPolicyConfig,
} from "@/modules/repayment-agent/domain/agent-policy";
import {
  toJsonSafe,
  type RepaymentObservation,
} from "@/modules/repayment-agent/domain/agent-run";
import { agentRepaymentIdToBytes32 } from "@/integrations/arc/escrow-v3";
import { formatUsdc } from "@/shared/money/usdc";

export type ToolCallRecord = Readonly<{
  name: string;
  arguments: unknown;
  result: unknown;
}>;

export type RepaymentToolName =
  | "get_repayment_context"
  | "list_outstanding_installments"
  | "get_arc_wallet_balance"
  | "get_reconciliation_health"
  | "list_available_actions"
  | "simulate_repayment";

const usdc = (value: bigint) => `${formatUsdc(value)} USDC`;

/** Tool definitions shared by every planner (function-calling JSON schemas). */
export const repaymentToolDefinitions: ReadonlyArray<{
  name: RepaymentToolName;
  description: string;
  parameters: Record<string, unknown>;
}> = [
  {
    name: "get_repayment_context",
    description:
      "Snapshot of the borrower's repayment situation: wallet, reserve, mandate limits, reconciliation and in-flight operations.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "list_outstanding_installments",
    description:
      "Outstanding obligations ordered by due date, with what the mandate allows the agent to pay on each right now and which limit binds.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_arc_wallet_balance",
    description:
      "Live on-chain USDC balance and escrow allowance. Use it to detect changes since the snapshot.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_reconciliation_health",
    description:
      "Whether the chain-to-database reconciliation is current. The agent must not pay while it is unhealthy.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "list_available_actions",
    description:
      "Every action the policy currently permits, with amount bounds in USDC base units.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "simulate_repayment",
    description:
      "Dry-run a candidate action through the policy checks and, for payments, an on-chain simulation. Nothing is executed.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...AGENT_ACTIONS] },
        loanRef: { type: "string" },
        amountBaseUnits: { type: "string" },
      },
      required: ["action", "loanRef", "amountBaseUnits"],
      additionalProperties: false,
    },
  },
];

export type RepaymentToolbox = Readonly<{
  agentAddress: string;
  policy: AgentPolicyConfig;
  observation: () => RepaymentObservation;
  call: (name: string, args: unknown) => Promise<unknown>;
  calls: () => ReadonlyArray<ToolCallRecord>;
}>;

export function createRepaymentToolbox(input: {
  observation: RepaymentObservation;
  gateway: RepaymentChainGateway;
  reconciliation: ReconciliationHealthReader;
  policy?: AgentPolicyConfig;
  now: () => Date;
}): RepaymentToolbox {
  const policy = input.policy ?? DEFAULT_AGENT_POLICY;
  const observation = input.observation;
  const records: ToolCallRecord[] = [];
  const context = {
    observation,
    agentAddress: input.gateway.agentAddress,
    policy,
  };

  const handlers: Record<RepaymentToolName, (args: never) => Promise<unknown>> =
    {
      async get_repayment_context() {
        const mandate = observation.mandate;
        const usable = isMandateUsable(
          mandate,
          input.gateway.agentAddress,
          observation.observedAt,
        );
        return {
          observedAt: observation.observedAt,
          walletBalance: usdc(observation.walletBalanceBaseUnits),
          walletBalanceBaseUnits: observation.walletBalanceBaseUnits,
          escrowAllowanceBaseUnits: observation.allowanceBaseUnits,
          mandate: mandate
            ? {
                usableByThisAgent: usable,
                maxPerRepayment: usdc(mandate.maxPerRepaymentBaseUnits),
                maxPerPeriod: usdc(mandate.maxPerPeriodBaseUnits),
                spentInPeriod: usdc(mandate.spentInPeriodBaseUnits),
                minimumReserve: usdc(mandate.minimumReserveBaseUnits),
                minimumReserveBaseUnits: mandate.minimumReserveBaseUnits,
                actsNoEarlierThanHoursBeforeDue:
                  mandate.earliestBeforeDueSeconds / 3_600,
                expiresInHours: hoursUntil(
                  mandate.expiresAt,
                  observation.observedAt,
                ),
              }
            : null,
          reconciliationHealthy: observation.reconciliation.healthy,
          repaymentInFlight: observation.inFlight
            ? {
                amount: usdc(observation.inFlight.amountBaseUnits),
                submitted: observation.inFlight.transactionHash !== null,
              }
            : null,
          openApprovalRequests: observation.pendingApprovals.map(
            (approval) => ({
              loanRef:
                observation.obligations.find(
                  (item) => item.loanId === approval.loanId,
                )?.ref ?? null,
              amount: usdc(approval.amountBaseUnits),
            }),
          ),
          recentFailureCodes: observation.recentFailures.map(
            (failure) => failure.code,
          ),
        };
      },
      async list_outstanding_installments() {
        return [...observation.obligations]
          .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())
          .map((obligation) => {
            const capacity = isMandateUsable(
              observation.mandate,
              input.gateway.agentAddress,
              observation.observedAt,
            )
              ? computeRepaymentCapacity({
                  mandate: observation.mandate,
                  obligation,
                  walletBalanceBaseUnits: observation.walletBalanceBaseUnits,
                  allowanceBaseUnits: observation.allowanceBaseUnits,
                  now: observation.observedAt,
                })
              : null;
            const hours = hoursUntil(obligation.dueAt, observation.observedAt);
            return {
              loanRef: obligation.ref,
              dueInHours: hours,
              overdue: hours < 0,
              dueSoon: hours * 3_600_000 <= policy.dueSoonMs,
              outstanding: usdc(obligation.outstandingBaseUnits),
              outstandingBaseUnits: obligation.outstandingBaseUnits,
              alreadyRepaid: usdc(obligation.repaidBaseUnits),
              agentCanAct: obligation.agentEligible,
              payableNowByMandateBaseUnits: capacity?.payableNowBaseUnits ?? 0n,
              bindingLimit: capacity?.bindingConstraint ?? "NO_MANDATE",
              repaymentWindowOpen: capacity?.windowOpen ?? false,
            };
          });
      },
      async get_arc_wallet_balance() {
        const live = await input.gateway.readBorrowerState(
          observation.borrowerWalletAddress,
        );
        return {
          walletBalance: usdc(live.walletBalanceBaseUnits),
          walletBalanceBaseUnits: live.walletBalanceBaseUnits,
          escrowAllowanceBaseUnits: live.allowanceBaseUnits,
          changedSinceSnapshot:
            live.walletBalanceBaseUnits !== observation.walletBalanceBaseUnits,
        };
      },
      async get_reconciliation_health() {
        const health = await input.reconciliation.read(input.now());
        return {
          healthy: health.healthy,
          lastSuccessfulAt: health.lastSuccessfulAt,
          reasonCode: health.reasonCode,
        };
      },
      async list_available_actions() {
        return computeAvailableActions(context);
      },
      async simulate_repayment(args: {
        action: AgentAction;
        loanRef: string;
        amountBaseUnits: string;
      }) {
        const candidate = {
          action: args.action,
          loanRef: args.loanRef,
          amountBaseUnits: args.amountBaseUnits,
          reasonCodes: ["PREVIOUS_ATTEMPT_FAILED"],
          explanation: `Simulation of ${args.amountBaseUnits} base units.`,
          rejectedAlternatives: [{ action: "STOP", reason: "simulation" }],
          confidence: 1,
          nextReviewInHours: null,
        };
        let amountText = args.amountBaseUnits;
        try {
          amountText = formatUsdc(BigInt(args.amountBaseUnits));
        } catch {
          // Invalid amounts are reported by the schema check below.
        }
        candidate.explanation = `Simulation of ${amountText} USDC.`;
        const validation = validateAgentDecision(candidate, context);
        const policyFailures = validation.checks
          .filter(
            (check) =>
              !check.passed && !["REASONS_SUPPORT_ACTION"].includes(check.code),
          )
          .map((check) => ({ code: check.code, detail: check.detail }));
        let onChain: unknown = "NOT_SIMULATED";
        if (
          policyFailures.length === 0 &&
          PAYMENT_ACTIONS.has(args.action) &&
          validation.obligation &&
          validation.amountBaseUnits !== null &&
          observation.mandate
        ) {
          onChain = await input.gateway.simulateAgentRepayment({
            chainLoanId: validation.obligation.chainLoanId,
            amountBaseUnits: validation.amountBaseUnits,
            chainRepaymentId: agentRepaymentIdToBytes32(
              `simulation:${validation.obligation.loanId}`,
            ),
            mandateNonce: observation.mandate.nonce,
          });
        }
        return {
          wouldPassPolicy: policyFailures.length === 0,
          policyFailures,
          onChainSimulation: onChain,
        };
      },
    };

  return {
    agentAddress: input.gateway.agentAddress,
    policy,
    observation: () => observation,
    calls: () => records,
    async call(name, args) {
      const handler = handlers[name as RepaymentToolName];
      const result = handler
        ? await handler((args ?? {}) as never)
        : { error: `Unknown tool ${name}.` };
      const safe = toJsonSafe(result);
      records.push({ name, arguments: toJsonSafe(args ?? {}), result: safe });
      return safe;
    },
  };
}
