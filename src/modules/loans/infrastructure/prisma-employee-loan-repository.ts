import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type { EmployeeLoanRepository } from "@/modules/loans/application/ports/employee-loan-repository";
import {
  calculatePrincipalReduction,
  type EmployeeBorrowedLoanRecord,
  type RecordedLoanRepayment,
} from "@/modules/loans/domain/employee-loan";

const repaymentSelection = {
  id: true,
  amountMinorUnits: true,
  currency: true,
  paidAt: true,
} as const;

const borrowedLoanSelection = {
  id: true,
  principalAmountMinorUnits: true,
  feeAmountMinorUnits: true,
  outstandingPrincipalMinorUnits: true,
  currency: true,
  durationDays: true,
  feeRateBasisPoints: true,
  status: true,
  startedAt: true,
  repaymentDueAt: true,
  lenderMembership: { select: { user: { select: { name: true } } } },
  repayments: {
    orderBy: { paidAt: "asc" as const },
    select: repaymentSelection,
  },
} as const;

type ExistingRepaymentRow = {
  id: string;
  amountMinorUnits: bigint;
  currency: string;
  paidAt: Date;
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
  return {
    id: repayment.id,
    loanId: repayment.loan.id,
    amountMinorUnits: repayment.amountMinorUnits,
    currency: repayment.currency,
    paidAt: repayment.paidAt,
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
          repayments: { select: { amountMinorUnits: true } },
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
        return { kind: "AMOUNT_EXCEEDS_REMAINING" } as const;
      }

      const balances = await transaction.employeeBalance.findMany({
        where: {
          organizationId,
          membershipId: {
            in: [loan.borrowerMembershipId, loan.lenderMembershipId],
          },
          currency: loan.currency,
        },
        select: { id: true, membershipId: true },
      });

      if (balances.length !== 2) {
        return { kind: "BALANCE_UNAVAILABLE" } as const;
      }

      const balanceIds = balances.map(({ id }) => id).sort();
      await transaction.$queryRaw`
        SELECT "id"
        FROM "EmployeeBalance"
        WHERE "id" IN (
          CAST(${balanceIds[0]} AS UUID),
          CAST(${balanceIds[1]} AS UUID)
        )
        ORDER BY "id"
        FOR UPDATE
      `;

      const lockedBalances = await transaction.employeeBalance.findMany({
        where: { id: { in: balanceIds }, organizationId },
        select: { id: true, membershipId: true, amountMinorUnits: true },
      });
      const borrowerBalance = lockedBalances.find(
        ({ membershipId }) => membershipId === loan.borrowerMembershipId,
      );
      const lenderBalance = lockedBalances.find(
        ({ membershipId }) => membershipId === loan.lenderMembershipId,
      );

      if (!borrowerBalance || !lenderBalance) {
        return { kind: "BALANCE_UNAVAILABLE" } as const;
      }

      const committedOffers = await transaction.lendingOffer.aggregate({
        where: {
          organizationId,
          lenderMembershipId: loan.borrowerMembershipId,
          currency: loan.currency,
          status: "ACTIVE",
          expiresAt: { gt: now },
        },
        _sum: { availableAmountMinorUnits: true },
      });
      const committedMinorUnits =
        committedOffers._sum.availableAmountMinorUnits ?? 0n;
      const availableBalanceMinorUnits =
        borrowerBalance.amountMinorUnits > committedMinorUnits
          ? borrowerBalance.amountMinorUnits - committedMinorUnits
          : 0n;

      if (command.amountMinorUnits > availableBalanceMinorUnits) {
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
          paidAt: now,
        },
        select: repaymentSelection,
      });

      await transaction.employeeBalance.update({
        where: { id: borrowerBalance.id },
        data: { amountMinorUnits: { decrement: command.amountMinorUnits } },
      });
      await transaction.employeeBalance.update({
        where: { id: lenderBalance.id },
        data: { amountMinorUnits: { increment: command.amountMinorUnits } },
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

      const [borrowerAccount, lenderAccount] = await Promise.all([
        transaction.ledgerAccount.upsert({
          where: {
            organizationId_membershipId_currency_type: {
              organizationId,
              membershipId: loan.borrowerMembershipId,
              currency: loan.currency,
              type: "MOCK_CASH",
            },
          },
          update: {},
          create: {
            organizationId,
            membershipId: loan.borrowerMembershipId,
            currency: loan.currency,
            type: "MOCK_CASH",
          },
          select: { id: true },
        }),
        transaction.ledgerAccount.upsert({
          where: {
            organizationId_membershipId_currency_type: {
              organizationId,
              membershipId: loan.lenderMembershipId,
              currency: loan.currency,
              type: "MOCK_CASH",
            },
          },
          update: {},
          create: {
            organizationId,
            membershipId: loan.lenderMembershipId,
            currency: loan.currency,
            type: "MOCK_CASH",
          },
          select: { id: true },
        }),
      ]);

      const ledgerTransaction = await transaction.ledgerTransaction.create({
        data: {
          organizationId,
          loanId: loan.id,
          repaymentId: repayment.id,
          type: "LOAN_REPAYMENT",
          currency: loan.currency,
        },
        select: { id: true },
      });
      await transaction.ledgerEntry.createMany({
        data: [
          {
            organizationId,
            transactionId: ledgerTransaction.id,
            accountId: borrowerAccount.id,
            direction: "CREDIT",
            amountMinorUnits: command.amountMinorUnits,
            currency: loan.currency,
          },
          {
            organizationId,
            transactionId: ledgerTransaction.id,
            accountId: lenderAccount.id,
            direction: "DEBIT",
            amountMinorUnits: command.amountMinorUnits,
            currency: loan.currency,
          },
        ],
      });

      await transaction.auditEvent.create({
        data: {
          organizationId,
          loanId: loan.id,
          type: "REPAYMENT_RECORDED",
          title: isFullyRepaid
            ? "Final repayment recorded"
            : "Partial repayment recorded",
          actorMembershipId: membership.id,
          actorLabel: membership.user.name,
          occurredAt: now,
        },
      });
      if (isFullyRepaid) {
        await transaction.auditEvent.create({
          data: {
            organizationId,
            loanId: loan.id,
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
          ...repayment,
          loanId: loan.id,
          loanStatus: updatedLoan.status,
        },
      } as const;
    });
  },
};
