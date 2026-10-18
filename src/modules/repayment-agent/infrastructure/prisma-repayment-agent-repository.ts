import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { agentRepaymentIdToBytes32 } from "@/integrations/arc/escrow-v3";
import { calculatePrincipalReduction } from "@/modules/loans/domain/employee-loan";
import {
  ConcurrentRunError,
  DuplicateInFlightError,
  type RepaymentAgentRepository,
  type StoredAction,
} from "@/modules/repayment-agent/application/ports";
import { allocateRepaymentOldestFirst } from "@/modules/repayment-plans/domain/repayment-plan";
import { USDC_BASE_UNITS_PER_CENT } from "@/shared/money/usdc";

const RUN_LEASE_MS = 15 * 60_000;
const PAYMENT_ACTIONS = ["PAY_FULL", "PAY_PARTIAL"];

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

type ActionRow = Prisma.RepaymentAgentActionGetPayload<object>;

function toStoredAction(row: ActionRow): StoredAction {
  return {
    id: row.id,
    runId: row.runId,
    loanId: row.loanId,
    action: row.action,
    amountBaseUnits: row.amountBaseUnits,
    status: row.status,
    repaymentRequestId: row.repaymentRequestId,
    chainRepaymentId: row.chainRepaymentId as `0x${string}`,
    mandateNonce: row.mandateNonce === null ? null : BigInt(row.mandateNonce),
    transactionHash: row.transactionHash as `0x${string}` | null,
    attempts: row.attempts,
    expiresAt: row.expiresAt,
    submittedAt: row.submittedAt,
  };
}

function minorUnitsRoundedUp(baseUnits: bigint) {
  return (baseUnits + USDC_BASE_UNITS_PER_CENT - 1n) / USDC_BASE_UNITS_PER_CENT;
}

/**
 * Settles a verified on-chain repayment into the application records:
 * repayment row, installment allocation, loan balance/status and audit trail,
 * atomically and idempotently. Shared by agent payments and borrower-approved
 * passkey payments.
 */
export async function settleVerifiedRepayment(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    loanId: string;
    repaymentRequestId: string;
    transactionHash: string;
    amountBaseUnits: bigint;
    remainingBaseUnits: bigint;
    paidAt: Date;
    actorMembershipId: string | null;
    source: "AGENT" | "BORROWER_APPROVAL";
  },
) {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`loan:${input.loanId}`}, 0))
  `;
  const loan = await transaction.loan.findFirstOrThrow({
    where: { id: input.loanId, organizationId: input.organizationId },
    select: {
      id: true,
      status: true,
      currency: true,
      principalAmountMinorUnits: true,
      feeAmountMinorUnits: true,
      outstandingPrincipalMinorUnits: true,
      activatedAt: true,
      startedAt: true,
      repaymentDueAt: true,
      borrowerMembershipId: true,
      lenderMembershipId: true,
      repayments: {
        where: { status: "COMPLETED" },
        select: { id: true, amountMinorUnits: true, repaymentRequestId: true },
      },
    },
  });
  const existing = await transaction.loanRepayment.findUnique({
    where: { repaymentRequestId: input.repaymentRequestId },
    select: { id: true, status: true },
  });
  if (existing?.status === "COMPLETED") return existing.id;

  const totalMinor = loan.principalAmountMinorUnits + loan.feeAmountMinorUnits;
  const previouslyRepaid = loan.repayments.reduce(
    (sum, item) => sum + item.amountMinorUnits,
    0n,
  );
  const isFinal = input.remainingBaseUnits === 0n;
  const amountMinor = isFinal
    ? totalMinor - previouslyRepaid
    : input.amountBaseUnits / USDC_BASE_UNITS_PER_CENT;
  if (amountMinor <= 0n) {
    throw new Error("REPAYMENT_AMOUNT_INCONSISTENT");
  }

  const repayment = existing
    ? await transaction.loanRepayment.update({
        where: { id: existing.id },
        data: {
          status: "COMPLETED",
          amountMinorUnits: amountMinor,
          paidAt: input.paidAt,
          completedAt: input.paidAt,
          submissionTransactionHash: input.transactionHash.toLowerCase(),
        },
        select: { id: true },
      })
    : await transaction.loanRepayment.create({
        data: {
          organizationId: input.organizationId,
          loanId: loan.id,
          repaymentRequestId: input.repaymentRequestId,
          submissionTransactionHash: input.transactionHash.toLowerCase(),
          amountMinorUnits: amountMinor,
          currency: loan.currency,
          status: "COMPLETED",
          paidAt: input.paidAt,
          completedAt: input.paidAt,
        },
        select: { id: true },
      });

  let installments = await transaction.loanInstallment.findMany({
    where: {
      organizationId: input.organizationId,
      loanId: loan.id,
      plan: { status: "ACTIVE" },
    },
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      amountMinorUnits: true,
      allocations: {
        where: { repayment: { status: "COMPLETED" } },
        select: { amountMinorUnits: true },
      },
    },
  });
  if (installments.length === 0) {
    const plan = await transaction.loanRepaymentPlan.create({
      data: {
        organizationId: input.organizationId,
        loanId: loan.id,
        version: 1,
        status: "ACTIVE",
        termMonths: 1,
        installmentCount: 1,
        totalRepaymentMinorUnits: totalMinor,
        currency: loan.currency,
        borrowerConsentedAt: loan.activatedAt ?? loan.startedAt,
        effectiveAt: loan.activatedAt ?? loan.startedAt,
      },
    });
    const installment = await transaction.loanInstallment.create({
      data: {
        organizationId: input.organizationId,
        loanId: loan.id,
        planId: plan.id,
        sequence: 1,
        amountMinorUnits: totalMinor,
        dueAt: loan.repaymentDueAt,
      },
      select: { id: true, sequence: true, amountMinorUnits: true },
    });
    installments = [{ ...installment, allocations: [] }];
  }
  const schedule = installments.map((installment) => ({
    id: installment.id,
    sequence: installment.sequence,
    amountMinorUnits: installment.amountMinorUnits,
    paidMinorUnits: installment.allocations.reduce(
      (sum, item) => sum + item.amountMinorUnits,
      0n,
    ),
  }));
  const scheduledOutstanding = schedule.reduce(
    (sum, item) => sum + item.amountMinorUnits - item.paidMinorUnits,
    0n,
  );
  const allocatable =
    amountMinor < scheduledOutstanding ? amountMinor : scheduledOutstanding;
  if (allocatable > 0n) {
    await transaction.repaymentAllocation.createMany({
      data: allocateRepaymentOldestFirst({
        repaymentAmountMinorUnits: allocatable,
        installments: schedule,
      }).map((allocation) => ({
        organizationId: input.organizationId,
        repaymentId: repayment.id,
        installmentId: allocation.installmentId,
        amountMinorUnits: allocation.amountMinorUnits,
      })),
      skipDuplicates: true,
    });
  }

  await transaction.loan.update({
    where: { id: loan.id },
    data: isFinal
      ? {
          status: "REPAID",
          outstandingPrincipalMinorUnits: 0n,
          closedAt: input.paidAt,
          onChainRepaidAt: input.paidAt,
          repaymentTransactionHash: input.transactionHash.toLowerCase(),
        }
      : {
          outstandingPrincipalMinorUnits: {
            decrement: calculatePrincipalReduction({
              feeAmountMinorUnits: loan.feeAmountMinorUnits,
              previouslyRepaidMinorUnits: previouslyRepaid,
              repaymentAmountMinorUnits: amountMinor,
              outstandingPrincipalMinorUnits:
                loan.outstandingPrincipalMinorUnits,
            }),
          },
        },
  });
  await transaction.auditEvent.createMany({
    data: [
      {
        organizationId: input.organizationId,
        loanId: loan.id,
        repaymentId: repayment.id,
        actorMembershipId: input.actorMembershipId,
        targetMembershipId: loan.lenderMembershipId,
        amountMinorUnits: amountMinor,
        currency: loan.currency,
        type: "REPAYMENT_COMPLETED",
        title:
          input.source === "AGENT"
            ? "Repayment agent payment verified on-chain"
            : "Borrower-approved repayment verified on-chain",
        occurredAt: input.paidAt,
        metadata: {
          source: input.source,
          transactionHash: input.transactionHash.toLowerCase(),
          remainingBaseUnits: input.remainingBaseUnits.toString(),
        },
      },
      ...(isFinal
        ? [
            {
              organizationId: input.organizationId,
              loanId: loan.id,
              repaymentId: repayment.id,
              actorMembershipId: input.actorMembershipId,
              targetMembershipId: loan.lenderMembershipId,
              amountMinorUnits: totalMinor,
              currency: loan.currency,
              type: "LOAN_REPAID" as const,
              title: "Loan repaid in full",
              occurredAt: input.paidAt,
              metadata: {
                transactionHash: input.transactionHash.toLowerCase(),
              },
            },
          ]
        : []),
    ],
  });
  return repayment.id;
}

export const prismaRepaymentAgentRepository: RepaymentAgentRepository = {
  async loadBorrower({ organizationId, borrowerMembershipId }) {
    const membership = await prisma.organizationMembership.findFirst({
      where: { id: borrowerMembershipId, organizationId },
      select: {
        id: true,
        isActive: true,
        role: true,
        employmentStatus: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            arcWallets: {
              where: { network: "ARC_TESTNET", status: "ACTIVE" },
              select: { address: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!membership) return null;
    return {
      organizationId,
      borrowerMembershipId,
      userId: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      walletAddress: membership.user.arcWallets[0]?.address ?? null,
      employmentActive:
        membership.isActive &&
        membership.role === "EMPLOYEE" &&
        membership.employmentStatus === "ACTIVE",
    };
  },

  async listObligations({ organizationId, borrowerMembershipId }) {
    const loans = await prisma.loan.findMany({
      where: {
        organizationId,
        borrowerMembershipId,
        status: { in: ["ACTIVE", "OVERDUE"] },
        chainLoanId: { not: null },
        contractAddress: { not: null },
        lenderWalletAddress: { not: null },
        repaymentBaseUnits: { not: null },
      },
      select: {
        id: true,
        chainLoanId: true,
        contractAddress: true,
        lenderWalletAddress: true,
        repaymentBaseUnits: true,
        repaymentDueAt: true,
        onChainDueAt: true,
      },
    });
    return loans.map((loan) => ({
      loanId: loan.id,
      chainLoanId: loan.chainLoanId!,
      contractAddress: loan.contractAddress!,
      lenderWalletAddress: loan.lenderWalletAddress!,
      repaymentBaseUnits: loan.repaymentBaseUnits!,
      dueAt: loan.onChainDueAt ?? loan.repaymentDueAt,
      // Observation confirms the contract is the mandate-capable escrow.
      agentEligible: true,
    }));
  },

  async findInFlightAction({ organizationId, borrowerMembershipId }) {
    const row = await prisma.repaymentAgentAction.findFirst({
      where: { organizationId, borrowerMembershipId, status: "SUBMITTED" },
    });
    return row ? toStoredAction(row) : null;
  },

  async findInFlight(borrower) {
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
  },

  async listPendingApprovals({ organizationId, borrowerMembershipId }) {
    const rows = await prisma.repaymentAgentAction.findMany({
      where: {
        organizationId,
        borrowerMembershipId,
        status: "AWAITING_APPROVAL",
      },
      select: {
        id: true,
        loanId: true,
        amountBaseUnits: true,
        expiresAt: true,
      },
    });
    return rows.map((row) => ({
      actionId: row.id,
      loanId: row.loanId,
      amountBaseUnits: row.amountBaseUnits ?? 0n,
      expiresAt: row.expiresAt ?? new Date(0),
    }));
  },

  async listRecentPayments({ organizationId, borrowerMembershipId }, since) {
    const rows = await prisma.repaymentAgentAction.findMany({
      where: {
        organizationId,
        borrowerMembershipId,
        status: "CONFIRMED",
        action: { in: PAYMENT_ACTIONS },
        confirmedAt: { gte: since },
      },
      select: { loanId: true, confirmedAt: true },
    });
    return rows.map((row) => ({ loanId: row.loanId, at: row.confirmedAt! }));
  },

  async listRecentFailures({ organizationId, borrowerMembershipId }, since) {
    const rows = await prisma.repaymentAgentAction.findMany({
      where: {
        organizationId,
        borrowerMembershipId,
        status: "FAILED",
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { failureCode: true, updatedAt: true },
    });
    return rows.map((row) => ({
      code: row.failureCode ?? "FAILED",
      at: row.updatedAt,
    }));
  },

  async expireApprovals({ organizationId, borrowerMembershipId }, now) {
    const result = await prisma.repaymentAgentAction.updateMany({
      where: {
        organizationId,
        borrowerMembershipId,
        status: "AWAITING_APPROVAL",
        expiresAt: { lt: now },
      },
      data: { status: "EXPIRED" },
    });
    return result.count;
  },

  async startRun(input) {
    await prisma.repaymentAgentRun.updateMany({
      where: {
        organizationId: input.borrower.organizationId,
        borrowerMembershipId: input.borrower.borrowerMembershipId,
        status: "RUNNING",
        startedAt: { lt: new Date(input.startedAt.getTime() - RUN_LEASE_MS) },
      },
      data: {
        status: "FAILED",
        outcomeCode: "RUN_LEASE_EXPIRED",
        completedAt: input.startedAt,
      },
    });
    try {
      return await prisma.repaymentAgentRun.create({
        data: {
          organizationId: input.borrower.organizationId,
          borrowerMembershipId: input.borrower.borrowerMembershipId,
          trigger: input.trigger,
          plannerKind: input.plannerKind,
          plannerModel: input.plannerModel,
          promptVersion: input.promptVersion,
          policyVersion: input.policyVersion,
          inputSnapshot: {},
          startedAt: input.startedAt,
          parentRunId: input.parentRunId,
        },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConcurrentRunError();
      throw error;
    }
  },

  async appendStep(runId, borrower, sequence, step) {
    await prisma.repaymentAgentStep.create({
      data: {
        organizationId: borrower.organizationId,
        runId,
        sequence,
        phase: step.phase,
        name: step.name.slice(0, 64),
        summary: step.summary.slice(0, 1_000),
        data: (step.data ?? {}) as Prisma.InputJsonValue,
      },
    });
  },

  async setRunSnapshot(runId, snapshot) {
    await prisma.repaymentAgentRun.update({
      where: { id: runId },
      data: { inputSnapshot: snapshot as Prisma.InputJsonValue },
    });
  },

  async finishRun(runId, input) {
    await prisma.repaymentAgentRun.update({
      where: { id: runId },
      data: {
        status: input.status,
        outcomeCode: input.outcomeCode,
        outcomeSummary: input.outcomeSummary,
        decision: (input.decision ?? undefined) as
          Prisma.InputJsonValue | undefined,
        requiresHumanApproval: input.requiresHumanApproval,
        completedAt: input.completedAt,
        plannerKind: input.plannerKind,
        plannerModel: input.plannerModel,
      },
    });
  },

  async createAction(input) {
    const chainRepaymentId = agentRepaymentIdToBytes32(
      input.repaymentRequestId,
    );
    // LoanRepayment_one_pending_per_loan allows one open intent per loan, so a
    // concurrent manual or agent intent surfaces here as a blocked duplicate.
    const row = await prisma
      .$transaction(async (transaction) => {
        const created = await transaction.repaymentAgentAction.create({
          data: {
            organizationId: input.borrower.organizationId,
            runId: input.runId,
            borrowerMembershipId: input.borrower.borrowerMembershipId,
            loanId: input.loanId,
            action: input.action,
            amountBaseUnits: input.amountBaseUnits,
            status: input.status,
            repaymentRequestId: input.repaymentRequestId,
            chainRepaymentId,
            mandateNonce: input.mandateNonce?.toString() ?? null,
            decision: input.decision as Prisma.InputJsonValue,
            validation: input.validation as unknown as Prisma.InputJsonValue,
            expiresAt: input.expiresAt,
          },
        });
        if (PAYMENT_ACTIONS.includes(input.action)) {
          const loan = await transaction.loan.findFirstOrThrow({
            where: {
              id: input.loanId,
              organizationId: input.borrower.organizationId,
            },
            select: { currency: true },
          });
          await transaction.loanRepayment.create({
            data: {
              organizationId: input.borrower.organizationId,
              loanId: input.loanId,
              repaymentRequestId: input.repaymentRequestId,
              amountMinorUnits: minorUnitsRoundedUp(input.amountBaseUnits),
              currency: loan.currency,
              status: "PENDING",
              paidAt: new Date(),
            },
          });
        }
        return created;
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw new DuplicateInFlightError();
        throw error;
      });
    return toStoredAction(row);
  },

  async markSubmitted(actionId, transactionHash, at) {
    try {
      await prisma.$transaction(async (transaction) => {
        const action = await transaction.repaymentAgentAction.update({
          where: { id: actionId, status: { in: ["VALIDATED", "SUBMITTED"] } },
          data: {
            status: "SUBMITTED",
            transactionHash: transactionHash.toLowerCase(),
            submittedAt: at,
            attempts: { increment: 1 },
          },
          select: { repaymentRequestId: true },
        });
        await transaction.loanRepayment.updateMany({
          where: {
            repaymentRequestId: action.repaymentRequestId,
            status: "PENDING",
          },
          data: { submissionTransactionHash: transactionHash.toLowerCase() },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateInFlightError();
      throw error;
    }
  },

  async markFailed(actionId, failureCode, verification) {
    await prisma.$transaction(async (transaction) => {
      const action = await transaction.repaymentAgentAction.findUnique({
        where: { id: actionId },
        select: { status: true, repaymentRequestId: true },
      });
      if (!action || action.status === "CONFIRMED") return;
      await transaction.repaymentAgentAction.update({
        where: { id: actionId },
        data: {
          status: "FAILED",
          failureCode: failureCode.slice(0, 64),
          verification: (verification ?? {}) as Prisma.InputJsonValue,
        },
      });
      await transaction.loanRepayment.updateMany({
        where: {
          repaymentRequestId: action.repaymentRequestId,
          status: "PENDING",
        },
        data: { status: "FAILED" },
      });
    });
  },

  async recordConfirmedRepayment(input) {
    await prisma.$transaction(async (transaction) => {
      const action = await transaction.repaymentAgentAction.findUniqueOrThrow({
        where: { id: input.actionId },
      });
      if (action.status === "CONFIRMED") return;
      await settleVerifiedRepayment(transaction, {
        organizationId: input.borrower.organizationId,
        loanId: input.loanId,
        repaymentRequestId: action.repaymentRequestId,
        transactionHash: input.transactionHash,
        amountBaseUnits: action.amountBaseUnits ?? 0n,
        remainingBaseUnits: input.verification.remainingBaseUnits,
        paidAt: input.verification.blockTimestamp,
        actorMembershipId: null,
        source: "AGENT",
      });
      await transaction.repaymentAgentAction.update({
        where: { id: input.actionId },
        data: {
          status: "CONFIRMED",
          transactionHash: input.transactionHash.toLowerCase(),
          confirmedAt: input.confirmedAt,
          verification: JSON.parse(
            JSON.stringify(input.verification, (_key, value) =>
              typeof value === "bigint" ? value.toString() : value,
            ),
          ) as Prisma.InputJsonValue,
        },
      });
    });
  },
};
