import {
  executePayment,
  notifyBorrower,
  settleSubmittedRepayment,
  type StepLogger,
} from "@/modules/repayment-agent/application/execute-agent-action";
import { observeBorrower } from "@/modules/repayment-agent/application/observe";
import type {
  PlannerHistoryEntry,
  RepaymentPlanner,
} from "@/modules/repayment-agent/application/planner";
import {
  ConcurrentRunError,
  DuplicateInFlightError,
  type BorrowerRef,
  type ReconciliationHealthReader,
  type RepaymentAgentRepository,
  type RepaymentChainGateway,
  type RepaymentNotifier,
} from "@/modules/repayment-agent/application/ports";
import {
  computeAvailableActions,
  validateAgentDecision,
} from "@/modules/repayment-agent/application/validate-agent-plan";
import type { AgentDecision } from "@/modules/repayment-agent/domain/agent-decision";
import {
  DEFAULT_AGENT_POLICY,
  REPAYMENT_AGENT_POLICY_VERSION,
  type AgentPolicyConfig,
} from "@/modules/repayment-agent/domain/agent-policy";
import {
  REPAYMENT_AGENT_PROMPT_VERSION,
  toJsonSafe,
  type AgentRunStatus,
  type AgentTrigger,
  type PolicyCheck,
  type RepaymentObservation,
} from "@/modules/repayment-agent/domain/agent-run";
import { createRepaymentToolbox } from "@/modules/repayment-agent/tools/repayment-tools";
import type { Clock } from "@/shared/time/clock";
import { formatUsdc } from "@/shared/money/usdc";

export type RepaymentAgentDependencies = Readonly<{
  repository: RepaymentAgentRepository;
  gateway: RepaymentChainGateway;
  reconciliation: ReconciliationHealthReader;
  notifier: RepaymentNotifier;
  planner: RepaymentPlanner;
  clock: Clock;
  newId: () => string;
  policy?: AgentPolicyConfig;
  hooks?: Readonly<{
    /** Demo and evaluation hook: runs after each confirmed payment. */
    afterPaymentConfirmed?: (info: {
      loanId: string;
      amountBaseUnits: bigint;
    }) => Promise<void>;
  }>;
}>;

export type RepaymentAgentRunSummary = Readonly<{
  runId: string;
  status: AgentRunStatus;
  outcomeCode: string;
  summary: string;
  decisions: ReadonlyArray<AgentDecision>;
  payments: ReadonlyArray<{
    loanId: string;
    amountBaseUnits: bigint;
    transactionHash: string;
  }>;
}>;

const usdc = (value: bigint) => `${formatUsdc(value)} USDC`;

function describeObservation(observation: RepaymentObservation) {
  const due = observation.obligations
    .filter((item) => item.outstandingBaseUnits > 0n)
    .map(
      (item) =>
        `${item.ref} ${usdc(item.outstandingBaseUnits)} due ${item.dueAt.toISOString().slice(0, 16)}Z`,
    )
    .join("; ");
  return `Wallet ${usdc(observation.walletBalanceBaseUnits)}, allowance ${usdc(observation.allowanceBaseUnits)}, reserve ${observation.mandate ? usdc(observation.mandate.minimumReserveBaseUnits) : "n/a"}, reconciliation ${observation.reconciliation.healthy ? "healthy" : "UNHEALTHY"}. Obligations: ${due || "none"}.`;
}

export async function runRepaymentAgent(
  borrower: BorrowerRef,
  trigger: AgentTrigger,
  deps: RepaymentAgentDependencies,
  options: { parentRunId?: string | null } = {},
): Promise<RepaymentAgentRunSummary> {
  const policy = deps.policy ?? DEFAULT_AGENT_POLICY;
  const now = () => deps.clock.now();
  let run: { id: string };
  try {
    run = await deps.repository.startRun({
      borrower,
      trigger,
      plannerKind: deps.planner.kind,
      plannerModel: deps.planner.model,
      promptVersion: REPAYMENT_AGENT_PROMPT_VERSION,
      policyVersion: REPAYMENT_AGENT_POLICY_VERSION,
      startedAt: now(),
      parentRunId: options.parentRunId ?? null,
    });
  } catch (error) {
    if (!(error instanceof ConcurrentRunError)) throw error;
    return {
      runId: "",
      status: "STOPPED",
      outcomeCode: "RUN_ALREADY_ACTIVE",
      summary:
        "Another agent run for this borrower is in progress; this one did nothing.",
      decisions: [],
      payments: [],
    };
  }
  let sequence = 0;
  const log: StepLogger = (step) =>
    deps.repository.appendStep(run.id, borrower, ++sequence, step);
  const decisions: AgentDecision[] = [];
  const payments: Array<{
    loanId: string;
    amountBaseUnits: bigint;
    transactionHash: string;
  }> = [];
  let plannerKind = deps.planner.kind;
  let plannerModel = deps.planner.model;

  const finish = async (
    status: AgentRunStatus,
    outcomeCode: string,
    summary: string,
    requiresHumanApproval = false,
  ): Promise<RepaymentAgentRunSummary> => {
    await log({
      phase: "EXPLAIN",
      name: outcomeCode,
      summary,
      data: toJsonSafe({ decisions, payments }),
    });
    await deps.repository.finishRun(run.id, {
      status,
      outcomeCode,
      outcomeSummary: summary.slice(0, 1_000),
      decision: toJsonSafe(decisions.at(-1) ?? null),
      requiresHumanApproval,
      completedAt: now(),
      plannerKind,
      plannerModel,
    });
    return {
      runId: run.id,
      status,
      outcomeCode,
      summary,
      decisions,
      payments,
    };
  };

  const profile = await deps.repository.loadBorrower(borrower);
  if (!profile?.walletAddress || !profile.employmentActive) {
    return finish(
      "STOPPED",
      profile ? "BORROWER_NOT_READY" : "BORROWER_NOT_FOUND",
      "Stopped: the borrower has no active Arc wallet or active membership.",
    );
  }
  const readyProfile = { ...profile, walletAddress: profile.walletAddress };
  const execution = {
    borrower,
    profile: readyProfile,
    repository: deps.repository,
    gateway: deps.gateway,
    policy,
    now,
    log,
  };
  const observe = () =>
    observeBorrower({
      borrower,
      profile: readyProfile,
      repository: deps.repository,
      gateway: deps.gateway,
      reconciliation: deps.reconciliation,
      policy,
      now: now(),
    });

  const expired = await deps.repository.expireApprovals(borrower, now());
  if (expired > 0) {
    await log({
      phase: "ADAPT",
      name: "APPROVALS_EXPIRED",
      summary: `${expired} unanswered approval request(s) expired and will be reconsidered.`,
      data: { expired },
    });
  }

  // Monitor before planning: an earlier submission is never duplicated.
  const inFlightAction = await deps.repository.findInFlightAction(borrower);
  if (inFlightAction?.transactionHash) {
    const { obligationsByLoanId } = await observe();
    const obligation = obligationsByLoanId.get(inFlightAction.loanId);
    await log({
      phase: "OBSERVE",
      name: "MONITOR_IN_FLIGHT",
      summary: `Found a submitted repayment of ${usdc(inFlightAction.amountBaseUnits ?? 0n)}; checking its receipt before anything else.`,
      data: {
        actionId: inFlightAction.id,
        transactionHash: inFlightAction.transactionHash,
      },
    });
    if (obligation) {
      const outcome = await settleSubmittedRepayment(
        execution,
        inFlightAction,
        obligation,
        inFlightAction.transactionHash,
      );
      if (outcome.kind === "PENDING") {
        return finish(
          "WAITING",
          "IN_FLIGHT_PENDING",
          "Waiting: the earlier repayment is not confirmed yet. It will be checked again; no new payment was made.",
        );
      }
      if (outcome.kind === "MISMATCH") {
        await notifyBorrower(deps.notifier, readyProfile, log, {
          kind: "ESCALATION",
          subject: "Repayment needs review",
          text: "A repayment transaction did not match what the agent expected. The agent has stopped and will not act until this is reviewed.",
          idempotencyKey: `agent-mismatch:${inFlightAction.id}`,
        });
        return finish(
          "ESCALATED",
          "VERIFICATION_MISMATCH",
          "Escalated: an on-chain receipt did not match the expected repayment. The agent stopped.",
          true,
        );
      }
      if (outcome.kind === "FAILED") {
        await deps.repository.markFailed(inFlightAction.id, outcome.code, {
          monitored: true,
        });
        await log({
          phase: "ADAPT",
          name: "IN_FLIGHT_FAILED",
          summary: `The earlier repayment failed (${outcome.code}); replanning from fresh state.`,
          data: outcome,
        });
      }
      if (outcome.kind === "CONFIRMED") {
        payments.push({
          loanId: inFlightAction.loanId,
          amountBaseUnits: outcome.amountBaseUnits,
          transactionHash: outcome.transactionHash,
        });
      }
    }
  }

  const history: PlannerHistoryEntry[] = [];
  let rejectedChecks: PolicyCheck[] | null = null;
  let rejectedPlans = 0;
  let actionsTaken = 0;
  let expectedBalance: bigint | null = null;
  let firstSnapshot = true;

  while (actionsTaken < policy.maxActionsPerRun) {
    const { observation, obligationsByLoanId, integrityIssues } =
      await observe();
    if (firstSnapshot) {
      await deps.repository.setRunSnapshot(run.id, toJsonSafe(observation));
      firstSnapshot = false;
    }
    await log({
      phase: "OBSERVE",
      name: "getRepaymentContext",
      summary: describeObservation(observation),
      data: toJsonSafe(observation),
    });
    for (const issue of integrityIssues) {
      await log({
        phase: "ADAPT",
        name: issue.code,
        summary:
          "A loan's on-chain parties disagree with the application record; the agent will not act on it.",
        data: issue,
      });
    }
    if (
      expectedBalance !== null &&
      observation.walletBalanceBaseUnits !== expectedBalance
    ) {
      const delta = observation.walletBalanceBaseUnits - expectedBalance;
      history.push({
        iteration: history.length + 1,
        action: "OBSERVE",
        loanRef: null,
        amountBaseUnits: null,
        outcome: "UNEXPECTED_BALANCE_CHANGE",
        note: `Wallet balance is ${usdc(observation.walletBalanceBaseUnits)}, ${delta < 0n ? "down" : "up"} ${usdc(delta < 0n ? -delta : delta)} from what the last payment left. Replanning.`,
      });
      await log({
        phase: "ADAPT",
        name: "UNEXPECTED_BALANCE_CHANGE",
        summary: history.at(-1)!.note,
        data: toJsonSafe({
          expectedBalance,
          observed: observation.walletBalanceBaseUnits,
        }),
      });
    }

    const available = computeAvailableActions({
      observation,
      agentAddress: deps.gateway.agentAddress,
      policy,
    });
    await log({
      phase: "REASON",
      name: "AVAILABLE_ACTIONS",
      summary: `Permitted: ${[...new Set(available.map((item) => `${item.action}${item.loanRef ? `(${item.loanRef})` : ""}`))].join(", ")}.`,
      data: toJsonSafe(available),
    });

    const toolbox = createRepaymentToolbox({
      observation,
      gateway: deps.gateway,
      reconciliation: deps.reconciliation,
      policy,
      now,
    });
    const plan = await deps.planner.plan({ toolbox, history, rejectedChecks });
    plannerKind = plan.kind;
    plannerModel = plan.model;
    for (const call of toolbox.calls()) {
      await log({
        phase: "TOOL",
        name: call.name,
        summary: `Planner called ${call.name}.`,
        data: call,
      });
    }
    if (plan.fallbackCode) {
      await log({
        phase: "ADAPT",
        name: "PLANNER_FALLBACK",
        summary: `The model planner was unavailable (${plan.fallbackCode}); the deterministic planner decided instead.`,
        data: { code: plan.fallbackCode },
      });
    }
    await log({
      phase: "REASON",
      name: "DECISION_PROPOSED",
      summary: `${plan.kind === "MODEL" ? `Model ${plan.model}` : "Rule planner"} proposed ${String((plan.decision as { action?: unknown })?.action ?? "an invalid decision")}.`,
      data: toJsonSafe(plan.decision),
    });

    const validation = validateAgentDecision(plan.decision, {
      observation,
      agentAddress: deps.gateway.agentAddress,
      policy,
    });
    const failed = validation.checks.filter((check) => !check.passed);
    await log({
      phase: "VALIDATE",
      name: "POLICY_CHECKS",
      summary: validation.valid
        ? `All ${validation.checks.length} policy checks passed.`
        : `Rejected by ${failed.length} check(s): ${failed.map((check) => check.code).join(", ")}.`,
      data: validation.checks,
    });
    if (!validation.valid || !validation.decision) {
      rejectedPlans += 1;
      rejectedChecks = failed;
      if (rejectedPlans >= policy.maxRejectedPlansPerRun) {
        await notifyBorrower(deps.notifier, readyProfile, log, {
          kind: "ESCALATION",
          subject: "Repayment agent paused",
          text: "The repayment agent could not produce a plan that satisfies your limits, so it paused without moving funds.",
          idempotencyKey: `agent-plan-rejected:${run.id}`,
        });
        return finish(
          "ESCALATED",
          "PLAN_REJECTED_REPEATEDLY",
          `Escalated: ${rejectedPlans} proposed plans failed policy checks. No funds moved.`,
          true,
        );
      }
      await log({
        phase: "ADAPT",
        name: "REPLAN_AFTER_REJECTION",
        summary: "Asking the planner for a different, permitted action.",
        data: failed,
      });
      continue;
    }
    rejectedChecks = null;
    const decision = validation.decision;
    decisions.push(decision);
    await log({
      phase: "EXPLAIN",
      name: "DECISION_ACCEPTED",
      summary: decision.explanation,
      data: toJsonSafe({
        action: decision.action,
        reasonCodes: decision.reasonCodes,
        rejectedAlternatives: decision.rejectedAlternatives,
        confidence: decision.confidence,
      }),
    });
    const loan = validation.obligation;
    const stored = loan ? obligationsByLoanId.get(loan.loanId) : undefined;

    switch (decision.action) {
      case "PAY_FULL":
      case "PAY_PARTIAL": {
        // Re-check against live state immediately before acting.
        const fresh = await observe();
        const recheck = validateAgentDecision(decision, {
          observation: fresh.observation,
          agentAddress: deps.gateway.agentAddress,
          policy,
        });
        const recheckFailed = recheck.checks.filter((check) => !check.passed);
        await log({
          phase: "VALIDATE",
          name: "PRE_EXECUTION_RECHECK",
          summary: recheck.valid
            ? "Fresh balance, mandate and reconciliation still permit the payment."
            : `Conditions changed before execution: ${recheckFailed.map((check) => check.code).join(", ")}.`,
          data: recheck.checks,
        });
        if (!recheck.valid || !stored || !fresh.observation.mandate) {
          rejectedPlans += 1;
          history.push({
            iteration: history.length + 1,
            action: decision.action,
            loanRef: decision.loanRef,
            amountBaseUnits: decision.amountBaseUnits,
            outcome: "CONDITIONS_CHANGED",
            note: `Not executed: ${recheckFailed.map((check) => check.detail).join(" ")}`,
          });
          if (rejectedPlans >= policy.maxRejectedPlansPerRun) {
            return finish(
              "WAITING",
              "CONDITIONS_UNSTABLE",
              "Waiting: conditions kept changing between planning and execution. No funds moved.",
            );
          }
          continue;
        }
        const beforeBalance = fresh.observation.walletBalanceBaseUnits;
        const outcome = await executePayment(execution, {
          runId: run.id,
          decision,
          validation: recheck,
          obligation: stored,
          mandateNonce: fresh.observation.mandate.nonce,
          newId: deps.newId,
        });
        actionsTaken += 1;
        if (outcome.kind === "CONFIRMED") {
          payments.push({
            loanId: stored.loanId,
            amountBaseUnits: outcome.amountBaseUnits,
            transactionHash: outcome.transactionHash,
          });
          expectedBalance = beforeBalance - outcome.amountBaseUnits;
          history.push({
            iteration: history.length + 1,
            action: decision.action,
            loanRef: decision.loanRef,
            amountBaseUnits: decision.amountBaseUnits,
            outcome: "CONFIRMED",
            note: `Paid ${usdc(outcome.amountBaseUnits)}; ${usdc(outcome.remainingBaseUnits)} remains on ${decision.loanRef}.`,
          });
          await deps.hooks?.afterPaymentConfirmed?.({
            loanId: stored.loanId,
            amountBaseUnits: outcome.amountBaseUnits,
          });
          continue;
        }
        if (outcome.kind === "PENDING") {
          return finish(
            "WAITING",
            "IN_FLIGHT_PENDING",
            `Submitted ${usdc(validation.amountBaseUnits ?? 0n)}; awaiting confirmation. The next run monitors it instead of paying again.`,
          );
        }
        if (outcome.kind === "MISMATCH") {
          return finish(
            "ESCALATED",
            "VERIFICATION_MISMATCH",
            "Escalated: the receipt did not match the expected repayment. The agent stopped.",
            true,
          );
        }
        if (outcome.kind === "DUPLICATE_BLOCKED") {
          return finish(
            "WAITING",
            "DUPLICATE_BLOCKED",
            "Another repayment was already in flight, so this one was not submitted.",
          );
        }
        const repeated = history.some(
          (entry) =>
            entry.outcome === "FAILED" && entry.note.includes(outcome.code),
        );
        history.push({
          iteration: history.length + 1,
          action: decision.action,
          loanRef: decision.loanRef,
          amountBaseUnits: decision.amountBaseUnits,
          outcome: "FAILED",
          note: `Failed with ${outcome.code}; ${outcome.retryable ? "transient" : "retrying cannot succeed"}.`,
        });
        if (repeated) {
          await notifyBorrower(deps.notifier, readyProfile, log, {
            kind: "ESCALATION",
            subject: "Repayment agent paused",
            text: `Repayments kept failing (${outcome.code}). The agent stopped without moving funds and will try again on its next scheduled run.`,
            idempotencyKey: `agent-repeated-failure:${run.id}`,
          });
          return finish(
            "ESCALATED",
            "REPEATED_FAILURE",
            `Escalated: the same failure (${outcome.code}) occurred twice in one run, so the agent stopped instead of looping.`,
            true,
          );
        }
        await log({
          phase: "ADAPT",
          name: "REPLAN_AFTER_FAILURE",
          summary: `Payment failed (${outcome.code}); replanning with fresh state instead of blindly retrying.`,
          data: outcome,
        });
        continue;
      }
      case "REQUEST_APPROVAL": {
        if (!loan || !stored || validation.amountBaseUnits === null) break;
        let created;
        try {
          created = await deps.repository.createAction({
            runId: run.id,
            borrower,
            loanId: loan.loanId,
            action: "REQUEST_APPROVAL",
            amountBaseUnits: validation.amountBaseUnits,
            status: "AWAITING_APPROVAL",
            mandateNonce: null,
            decision: toJsonSafe(decision),
            validation: validation.checks,
            expiresAt: new Date(now().getTime() + policy.approvalTtlMs),
            repaymentRequestId: deps.newId(),
          });
        } catch (error) {
          if (error instanceof DuplicateInFlightError) break;
          throw error;
        }
        await log({
          phase: "ACT",
          name: "escalateForHumanApproval",
          summary: `Requested passkey approval for ${usdc(validation.amountBaseUnits)} on ${loan.ref}.`,
          data: toJsonSafe({
            actionId: created.id,
            expiresAt: created.expiresAt,
          }),
        });
        await notifyBorrower(deps.notifier, readyProfile, log, {
          kind: "APPROVAL_REQUESTED",
          subject: `Approve a ${usdc(validation.amountBaseUnits)} repayment`,
          text: `${decision.explanation} Open QastFund to approve it with your passkey, or ignore this to let it expire.`,
          idempotencyKey: `agent-approval:${created.id}`,
        });
        return finish(
          "AWAITING_APPROVAL",
          "APPROVAL_REQUESTED",
          decision.explanation,
          true,
        );
      }
      case "NOTIFY_USER": {
        await notifyBorrower(deps.notifier, readyProfile, log, {
          kind: "INFO",
          subject: "Update from your repayment agent",
          text: decision.explanation,
          idempotencyKey: `agent-info:${borrower.borrowerMembershipId}:${decision.reasonCodes.join(",")}:${now().toISOString().slice(0, 10)}`,
        });
        return finish("COMPLETED", "NOTIFIED", decision.explanation);
      }
      case "ESCALATE": {
        await notifyBorrower(deps.notifier, readyProfile, log, {
          kind: "ESCALATION",
          subject: "Your repayment needs attention",
          text: decision.explanation,
          idempotencyKey: `agent-escalation:${run.id}`,
        });
        return finish("ESCALATED", "ESCALATED", decision.explanation, true);
      }
      case "WAIT":
        return finish(
          "WAITING",
          "WAIT",
          `${decision.explanation} Next review in ${decision.nextReviewInHours ?? 24} hours.`,
        );
      case "STOP":
        return finish(
          payments.length > 0 ? "COMPLETED" : "STOPPED",
          payments.length > 0 ? "PAYMENTS_COMPLETED" : "STOPPED",
          decision.explanation,
        );
    }
    return finish(
      "FAILED",
      "UNHANDLED_DECISION",
      "The validated decision could not be executed.",
    );
  }
  return finish(
    "COMPLETED",
    "ACTION_LIMIT_REACHED",
    `Completed ${payments.length} payment(s); the per-run action limit was reached.`,
  );
}
