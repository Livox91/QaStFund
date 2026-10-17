import {
  DuplicateInFlightError,
  type BorrowerProfile,
  type BorrowerRef,
  type ExpectedRepayment,
  type RepaymentAgentRepository,
  type RepaymentChainGateway,
  type RepaymentNotifier,
  type StoredAction,
  type StoredObligation,
} from "@/modules/repayment-agent/application/ports";
import type { ValidationResult } from "@/modules/repayment-agent/application/validate-agent-plan";
import type { AgentDecision } from "@/modules/repayment-agent/domain/agent-decision";
import type { AgentPolicyConfig } from "@/modules/repayment-agent/domain/agent-policy";
import {
  toJsonSafe,
  type AgentStep,
} from "@/modules/repayment-agent/domain/agent-run";
import { formatUsdc } from "@/shared/money/usdc";

export type StepLogger = (step: AgentStep) => Promise<void>;

export type PaymentOutcome =
  | Readonly<{
      kind: "CONFIRMED";
      amountBaseUnits: bigint;
      remainingBaseUnits: bigint;
      transactionHash: `0x${string}`;
    }>
  | Readonly<{ kind: "PENDING"; transactionHash: `0x${string}` }>
  | Readonly<{ kind: "FAILED"; code: string; retryable: boolean }>
  | Readonly<{ kind: "MISMATCH"; transactionHash: `0x${string}` }>
  | Readonly<{ kind: "DUPLICATE_BLOCKED" }>;

type ExecutionContext = Readonly<{
  borrower: BorrowerRef;
  profile: BorrowerProfile & { walletAddress: string };
  repository: RepaymentAgentRepository;
  gateway: RepaymentChainGateway;
  policy: AgentPolicyConfig;
  now: () => Date;
  log: StepLogger;
}>;

const usdc = (value: bigint) => `${formatUsdc(value)} USDC`;

export function expectedRepayment(
  action: Pick<StoredAction, "chainRepaymentId" | "amountBaseUnits">,
  obligation: StoredObligation,
  borrowerWallet: string,
  agent: string | null,
): ExpectedRepayment {
  return {
    chainLoanId: obligation.chainLoanId,
    chainRepaymentId: action.chainRepaymentId,
    amountBaseUnits: action.amountBaseUnits ?? 0n,
    borrower: borrowerWallet,
    lender: obligation.lenderWalletAddress,
    agent,
  };
}

/**
 * Verifies a submitted agent repayment and settles the application record.
 * Shared by fresh submissions and by monitoring of an earlier in-flight one.
 */
export async function settleSubmittedRepayment(
  context: ExecutionContext,
  action: StoredAction,
  obligation: StoredObligation,
  transactionHash: `0x${string}`,
): Promise<PaymentOutcome> {
  const expected = expectedRepayment(
    action,
    obligation,
    context.profile.walletAddress,
    context.gateway.agentAddress,
  );
  const verification = await context.gateway.verifyRepayment(
    transactionHash,
    expected,
    context.policy.receiptTimeoutMs,
  );
  await context.log({
    phase: "VERIFY",
    name: "verifyRepaymentReceipt",
    summary:
      verification.status === "VERIFIED"
        ? `Receipt verified: exact repayment event, agent event and one USDC transfer of ${usdc(expected.amountBaseUnits)}.`
        : verification.status === "PENDING"
          ? "No receipt yet; the operation will be monitored, never resubmitted."
          : verification.status === "REVERTED"
            ? `Transaction reverted (${verification.errorName ?? "unknown reason"}).`
            : "Receipt does not match the expected repayment.",
    data: toJsonSafe({ transactionHash, verification }),
  });

  if (verification.status === "PENDING") {
    const submittedAt = action.submittedAt ?? context.now();
    if (
      !verification.transactionKnown &&
      context.now().getTime() - submittedAt.getTime() >
        context.policy.droppedAfterMs
    ) {
      await context.repository.markFailed(action.id, "TRANSACTION_DROPPED", {
        transactionHash,
      });
      return { kind: "FAILED", code: "TRANSACTION_DROPPED", retryable: true };
    }
    return { kind: "PENDING", transactionHash };
  }
  if (verification.status === "MISMATCH") {
    await context.repository.markFailed(
      action.id,
      "VERIFICATION_MISMATCH",
      toJsonSafe(verification),
    );
    return { kind: "MISMATCH", transactionHash };
  }
  if (verification.status === "REVERTED") {
    return {
      kind: "FAILED",
      code: verification.errorName ?? "TRANSACTION_REVERTED",
      retryable: verification.retryable,
    };
  }
  await context.repository.recordConfirmedRepayment({
    actionId: action.id,
    borrower: context.borrower,
    loanId: action.loanId,
    transactionHash,
    verification,
    confirmedAt: context.now(),
  });
  await context.log({
    phase: "VERIFY",
    name: "LEDGER_UPDATED",
    summary: `Recorded the repayment; ${usdc(verification.remainingBaseUnits)} remains on the loan.`,
    data: toJsonSafe({
      totalRepaidBaseUnits: verification.totalRepaidBaseUnits,
      remainingBaseUnits: verification.remainingBaseUnits,
      blockNumber: verification.blockNumber,
    }),
  });
  return {
    kind: "CONFIRMED",
    amountBaseUnits: expected.amountBaseUnits,
    remainingBaseUnits: verification.remainingBaseUnits,
    transactionHash,
  };
}

/** Executes a validated PAY_FULL / PAY_PARTIAL decision. */
export async function executePayment(
  context: ExecutionContext,
  input: {
    runId: string;
    decision: AgentDecision;
    validation: ValidationResult;
    obligation: StoredObligation;
    mandateNonce: bigint;
    newId: () => string;
  },
): Promise<PaymentOutcome> {
  const amount = input.validation.amountBaseUnits!;
  const loan = input.validation.obligation!;
  const repaymentRequestId = input.newId();
  let action: StoredAction;
  try {
    action = await context.repository.createAction({
      runId: input.runId,
      borrower: context.borrower,
      loanId: loan.loanId,
      action: input.decision.action,
      amountBaseUnits: amount,
      status: "VALIDATED",
      mandateNonce: input.mandateNonce,
      decision: toJsonSafe(input.decision),
      validation: input.validation.checks,
      expiresAt: null,
      repaymentRequestId,
    });
  } catch (error) {
    if (error instanceof DuplicateInFlightError) {
      await context.log({
        phase: "ADAPT",
        name: "DUPLICATE_BLOCKED",
        summary:
          "Another repayment is already in flight for this borrower; nothing was submitted.",
        data: {},
      });
      return { kind: "DUPLICATE_BLOCKED" };
    }
    throw error;
  }
  await context.log({
    phase: "ACT",
    name: "createRepaymentIntent",
    summary: `Created repayment intent for ${usdc(amount)} on ${loan.ref} with on-chain id ${action.chainRepaymentId.slice(0, 10)}…`,
    data: toJsonSafe({
      actionId: action.id,
      repaymentRequestId: action.repaymentRequestId,
      chainRepaymentId: action.chainRepaymentId,
      mandateNonce: input.mandateNonce,
    }),
  });

  const request = {
    chainLoanId: loan.chainLoanId,
    amountBaseUnits: amount,
    chainRepaymentId: action.chainRepaymentId,
    mandateNonce: input.mandateNonce,
  };
  let lastFailure: PaymentOutcome = {
    kind: "FAILED",
    code: "NOT_ATTEMPTED",
    retryable: false,
  };
  for (
    let attempt = 0;
    attempt <= context.policy.maxSafeRetries;
    attempt += 1
  ) {
    const simulation = await context.gateway.simulateAgentRepayment(request);
    await context.log({
      phase: "ACT",
      name: "simulateRepayment",
      summary: simulation.ok
        ? "On-chain simulation succeeded against the live mandate and balance."
        : `On-chain simulation reverted with ${simulation.errorName}.`,
      data: toJsonSafe(simulation),
    });
    if (!simulation.ok) {
      await context.repository.markFailed(action.id, simulation.errorName, {
        simulation,
      });
      return {
        kind: "FAILED",
        code: simulation.errorName,
        retryable: false,
      };
    }

    let transactionHash: `0x${string}`;
    const signed: { hash: `0x${string}` | null } = { hash: null };
    try {
      transactionHash = await context.gateway.submitAgentRepayment(
        request,
        async (hash) => {
          await context.repository.markSubmitted(
            action.id,
            hash,
            context.now(),
          );
          signed.hash = hash;
        },
      );
    } catch (error) {
      if (error instanceof DuplicateInFlightError) {
        await context.repository.markFailed(action.id, "DUPLICATE_BLOCKED", {});
        await context.log({
          phase: "ADAPT",
          name: "DUPLICATE_BLOCKED",
          summary:
            "The database refused a second in-flight repayment, so the signed transaction was never broadcast.",
          data: {},
        });
        return { kind: "DUPLICATE_BLOCKED" };
      }
      if (signed.hash) {
        // Signed and recorded, but the broadcast errored: the node may still
        // have it. Treat it as in flight and monitor; never re-sign a new
        // payment beside it.
        await context.log({
          phase: "ADAPT",
          name: "BROADCAST_UNCERTAIN",
          summary:
            "Broadcasting reported an error after signing. The payment is treated as in flight and will be monitored until it confirms or is proven dropped.",
          data: { transactionHash: signed.hash },
        });
        return { kind: "PENDING", transactionHash: signed.hash };
      }
      // Failed before a signature existed: nothing can reach the chain.
      await context.repository.markFailed(action.id, "SIGNING_FAILED", {
        attempt,
      });
      return { kind: "FAILED", code: "SIGNING_FAILED", retryable: false };
    }
    action = { ...action, transactionHash, submittedAt: context.now() };
    await context.log({
      phase: "ACT",
      name: "submitAuthorizedRepayment",
      summary: `Submitted repayOnBehalf for ${usdc(amount)} under mandate nonce ${input.mandateNonce}.`,
      data: { transactionHash, attempt },
    });

    const outcome = await settleSubmittedRepayment(
      context,
      action,
      input.obligation,
      transactionHash,
    );
    if (outcome.kind !== "FAILED" || !outcome.retryable) {
      if (outcome.kind === "FAILED") {
        await context.repository.markFailed(action.id, outcome.code, {
          transactionHash,
        });
      }
      return outcome;
    }
    lastFailure = outcome;
    if (attempt < context.policy.maxSafeRetries) {
      await context.log({
        phase: "ADAPT",
        name: "SAFE_RETRY",
        summary: `Retrying after a transient failure (${outcome.code}) with the same on-chain repayment id, so at most one payment can land.`,
        data: { attempt: attempt + 1 },
      });
    }
  }
  if (lastFailure.kind === "FAILED") {
    await context.repository.markFailed(action.id, lastFailure.code, {
      retriesExhausted: true,
    });
  }
  return lastFailure;
}

export async function notifyBorrower(
  notifier: RepaymentNotifier,
  profile: BorrowerProfile,
  log: StepLogger,
  notification: Parameters<RepaymentNotifier["notify"]>[1],
) {
  const result = await notifier.notify(profile, notification);
  await log({
    phase: "ACT",
    name: "sendRepaymentNotification",
    summary: result.delivered
      ? `Notified the borrower: ${notification.subject}`
      : `Notification not delivered (${result.code ?? "unknown"}); it remains visible in the activity log.`,
    data: {
      kind: notification.kind,
      delivered: result.delivered,
      code: result.code,
    },
  });
  return result;
}
