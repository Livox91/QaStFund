import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type { EmployeeLoanRepository } from "@/modules/loans/application/ports/employee-loan-repository";
import {
  ensureUserWallet,
  getCompletedAccountBalance,
  lockLedgerAccounts,
  postLedgerTransaction,
} from "@/modules/ledger/infrastructure/ledger-posting";
import {
  calculatePrincipalReduction,
  type EmployeeBorrowedLoanRecord,
  type RecordedLoanRepayment,
} from "@/modules/loans/domain/employee-loan";

const repaymentSelection = {
  id: true,
  amountMinorUnits: true,
  currency: true,
  status: true,
  createdAt: true,
  completedAt: true,
  paidAt: true,
} as const;

const borrowedLoanSelection = {
  id: true,
  principalAmountMinorUnits: true,
  feeAmountMinorUnits: true,
  outstandingPrincipalMinorUnits: true,
  repaymentBaseUnits: true,
  currency: true,
  durationDays: true,
  feeRateBasisPoints: true,
  status: true,
  startedAt: true,
  repaymentDueAt: true,
  lenderMembership: { select: { user: { select: { name: true } } } },
  repayments: {
    where: { status: "COMPLETED" as const },
    orderBy: { paidAt: "asc" as const },
    select: repaymentSelection,
  },
} as const;

type ExistingRepaymentRow = {
  id: string;
  amountMinorUnits: bigint;
  currency: string;
  paidAt: Date;
  completedAt: Date | null;
  loan: {
    id: string;
    organizationId: string;
    borrowerMembershipId: string;
    status: RecordedLoanRepayment["loanStatus"];
  };
};

function toRecordedRepayment(
  repayment: ExistingRepaymentRow,
): RecordedLoanRepayment {
  if (!repayment.completedAt) {
    throw new Error("Completed repayment has no completion timestamp.");
  }

  return {
    id: repayment.id,
    loanId: repayment.loan.id,
    amountMinorUnits: repayment.amountMinorUnits,
    currency: repayment.currency,
    paidAt: repayment.paidAt,
    completedAt: repayment.completedAt,
    loanStatus: repayment.loan.status,
  };
}

export const prismaEmployeeLoanRepository: EmployeeLoanRepository = {
  async findBorrowedLoan({ organizationId, userId, loanId }) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, isActive: true, role: true },
    });

    if (!membership?.isActive || membership.role !== MembershipRole.EMPLOYEE) {
      return null;
    }

    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
        borrowerMembershipId: membership.id,
      },
      select: borrowedLoanSelection,
    });

    if (!loan) return null;

    return {
      ...loan,
      lenderName: loan.lenderMembership.user.name,
    } as EmployeeBorrowedLoanRecord;
  },

  async repayBorrowedLoan({ organizationId, userId, command, now }) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${command.requestId}, 0))
      `;

      const membership = await transaction.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: {
          id: true,
          isActive: true,
          role: true,
          user: { select: { name: true } },
        },
      });

      if (
        !membership?.isActive ||
        membership.role !== MembershipRole.EMPLOYEE
      ) {
        return { kind: "LOAN_NOT_FOUND" } as const;
      }

      const existingRepayment = await transaction.loanRepayment.findUnique({
        where: { repaymentRequestId: command.requestId },
        select: {
          ...repaymentSelection,
          loan: {
            select: {
              id: true,
              organizationId: true,
              borrowerMembershipId: true,
              status: true,
            },
          },
        },
      });

      if (existingRepayment) {
        const isSameRequest =
          existingRepayment.loan.organizationId === organizationId &&
          existingRepayment.loan.borrowerMembershipId === membership.id &&
          existingRepayment.loan.id === command.loanId &&
          existingRepayment.amountMinorUnits === command.amountMinorUnits;

        return isSameRequest
          ? ({
              kind: "ALREADY_RECORDED",
              repayment: toRecordedRepayment(existingRepayment),
            } as const)
          : ({ kind: "REQUEST_CONFLICT" } as const);
      }

      // Every repayment for a loan locks the same row. This serializes partial
      // payments so their combined amount cannot exceed the remaining terms.
      await transaction.$queryRaw`
        SELECT "id"
        FROM "Loan"
        WHERE "id" = CAST(${command.loanId} AS UUID)
          AND "organizationId" = CAST(${organizationId} AS UUID)
        FOR UPDATE
      `;

      const loan = await transaction.loan.findFirst({
        where: {
          id: command.loanId,
          organizationId,
          borrowerMembershipId: membership.id,
        },
        select: {
          id: true,
          lenderMembershipId: true,
          borrowerMembershipId: true,
          principalAmountMinorUnits: true,
          feeAmountMinorUnits: true,
          outstandingPrincipalMinorUnits: true,
          currency: true,
          status: true,
          repayments: {
            where: { status: "COMPLETED" },
            select: { amountMinorUnits: true },
          },
        },
      });

      if (!loan) return { kind: "LOAN_NOT_FOUND" } as const;
      if (loan.status !== "ACTIVE" && loan.status !== "OVERDUE") {
        return { kind: "LOAN_NOT_REPAYABLE" } as const;
      }

      const previouslyRepaidMinorUnits = loan.repayments.reduce(
        (total, repayment) => total + repayment.amountMinorUnits,
        0n,
      );
      const totalAgreedAmountMinorUnits =
        loan.principalAmountMinorUnits + loan.feeAmountMinorUnits;
      const remainingAmountMinorUnits =
        previouslyRepaidMinorUnits < totalAgreedAmountMinorUnits
          ? totalAgreedAmountMinorUnits - previouslyRepaidMinorUnits
          : 0n;

      if (remainingAmountMinorUnits === 0n) {
        return { kind: "LOAN_NOT_REPAYABLE" } as const;
      }
      if (command.amountMinorUnits > remainingAmountMinorUnits) {
        return {
          kind: "AMOUNT_EXCEEDS_REMAINING",
          remainingAmountMinorUnits,
          currency: loan.currency,
        } as const;
      }

      const borrowerWallet = await ensureUserWallet(transaction, {
        organizationId,
        membershipId: loan.borrowerMembershipId,
      });
      const lenderWallet = await ensureUserWallet(transaction, {
        organizationId,
        membershipId: loan.lenderMembershipId,
      });
      await lockLedgerAccounts(transaction, organizationId, [
        borrowerWallet.id,
        lenderWallet.id,
      ]);
      const borrowerBalance = await getCompletedAccountBalance(transaction, {
        organizationId,
        accountId: borrowerWallet.id,
      });
      if (borrowerBalance < command.amountMinorUnits) {
        return { kind: "INSUFFICIENT_BALANCE" } as const;
      }

      const principalReduction = calculatePrincipalReduction({
        feeAmountMinorUnits: loan.feeAmountMinorUnits,
        previouslyRepaidMinorUnits,
        repaymentAmountMinorUnits: command.amountMinorUnits,
        outstandingPrincipalMinorUnits: loan.outstandingPrincipalMinorUnits,
      });
      const isFullyRepaid =
        command.amountMinorUnits === remainingAmountMinorUnits;

      const repayment = await transaction.loanRepayment.create({
        data: {
          organizationId,
          loanId: loan.id,
          repaymentRequestId: command.requestId,
          amountMinorUnits: command.amountMinorUnits,
          currency: loan.currency,
          status: "COMPLETED",
          paidAt: now,
          completedAt: now,
        },
        select: repaymentSelection,
      });

      await postLedgerTransaction(transaction, {
        organizationId,
        type: "LOAN_REPAYMENT",
        referenceType: "REPAYMENT",
        referenceId: repayment.id,
        idempotencyKey: `repayment:${command.requestId}`,
        now,
        accountsAlreadyLocked: true,
        entries: [
          {
            accountId: borrowerWallet.id,
            direction: "DEBIT",
            amountMinorUnits: command.amountMinorUnits,
          },
          {
            accountId: lenderWallet.id,
            direction: "CREDIT",
            amountMinorUnits: command.amountMinorUnits,
          },
        ],
      });

      const updatedLoan = await transaction.loan.update({
        where: { id: loan.id },
        data: {
          outstandingPrincipalMinorUnits: {
            decrement: principalReduction,
          },
          ...(isFullyRepaid ? { status: "REPAID", closedAt: now } : {}),
        },
        select: { status: true },
      });

      await transaction.auditEvent.createMany({
        data: [
          {
            organizationId,
            loanId: loan.id,
            repaymentId: repayment.id,
            amountMinorUnits: command.amountMinorUnits,
            currency: loan.currency,
            type: "REPAYMENT_CREATED",
            title: "Repayment created",
            actorMembershipId: membership.id,
            actorLabel: membership.user.name,
            occurredAt: now,
          },
          {
            organizationId,
            loanId: loan.id,
            repaymentId: repayment.id,
            amountMinorUnits: command.amountMinorUnits,
            currency: loan.currency,
            type: "REPAYMENT_COMPLETED",
            title: isFullyRepaid
              ? "Final repayment completed"
              : "Partial repayment completed",
            actorMembershipId: membership.id,
            actorLabel: membership.user.name,
            occurredAt: now,
          },
        ],
      });
      if (isFullyRepaid) {
        await transaction.auditEvent.create({
          data: {
            organizationId,
            loanId: loan.id,
            repaymentId: repayment.id,
            amountMinorUnits: command.amountMinorUnits,
            currency: loan.currency,
            type: "LOAN_REPAID",
            title: "Loan repaid in full",
            actorMembershipId: membership.id,
            actorLabel: membership.user.name,
            occurredAt: now,
          },
        });
      }

      return {
        kind: "RECORDED",
        repayment: {
          id: repayment.id,
          loanId: loan.id,
          amountMinorUnits: repayment.amountMinorUnits,
          currency: repayment.currency,
          paidAt: repayment.paidAt,
          completedAt: now,
          loanStatus: updatedLoan.status,
        },
      } as const;
    });
  },
};
