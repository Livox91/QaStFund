import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type { BorrowLoanRepository } from "@/modules/loans/application/ports/borrow-loan-repository";
import {
  calculateBorrowLoanSummary,
  type BorrowableOffer,
  type CreatedBorrowingLoan,
} from "@/modules/loans/domain/borrow-loan";

const offerSelection = {
  id: true,
  availableAmountMinorUnits: true,
  minimumLoanAmountMinorUnits: true,
  maximumLoanAmountMinorUnits: true,
  currency: true,
  durationDays: true,
  feeRateBasisPoints: true,
  expiresAt: true,
} as const;

const createdLoanSelection = {
  id: true,
  lendingOfferId: true,
  principalAmountMinorUnits: true,
  feeAmountMinorUnits: true,
  currency: true,
  durationDays: true,
  feeRateBasisPoints: true,
  repaymentDueAt: true,
} as const;

type CreatedLoanRow = {
  id: string;
  lendingOfferId: string | null;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  currency: string;
  durationDays: number;
  feeRateBasisPoints: number;
  repaymentDueAt: Date;
};

function toCreatedLoan(row: CreatedLoanRow): CreatedBorrowingLoan {
  if (!row.lendingOfferId) {
    throw new Error("Borrow request is not linked to a lending offer.");
  }

  return {
    id: row.id,
    offerId: row.lendingOfferId,
    principalAmountMinorUnits: row.principalAmountMinorUnits,
    feeAmountMinorUnits: row.feeAmountMinorUnits,
    totalRepaymentMinorUnits:
      row.principalAmountMinorUnits + row.feeAmountMinorUnits,
    currency: row.currency,
    durationDays: row.durationDays,
    feeRateBasisPoints: row.feeRateBasisPoints,
    repaymentDueAt: row.repaymentDueAt,
  };
}

export const prismaBorrowLoanRepository: BorrowLoanRepository = {
  async findBorrowableOffer({ organizationId, userId, offerId, now }) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, isActive: true, role: true },
    });

    if (!membership?.isActive || membership.role !== MembershipRole.EMPLOYEE) {
      return null;
    }

    return prisma.lendingOffer.findFirst({
      where: {
        id: offerId,
        organizationId,
        lenderMembershipId: { not: membership.id },
        status: "ACTIVE",
        expiresAt: { gt: now },
        availableAmountMinorUnits: { gt: 0n },
        lenderMembership: { isActive: true, role: MembershipRole.EMPLOYEE },
      },
      select: offerSelection,
    }) as Promise<BorrowableOffer | null>;
  },

  async createFromOffer({ organizationId, userId, command, now }) {
    return prisma.$transaction(async (transaction) => {
      // A transaction-scoped advisory lock serializes retries with the same
      // client-generated key, including retries that target different offers.
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
        return { kind: "OFFER_NOT_AVAILABLE" } as const;
      }

      const existingLoan = await transaction.loan.findUnique({
        where: { borrowRequestId: command.requestId },
        select: {
          ...createdLoanSelection,
          organizationId: true,
          borrowerMembershipId: true,
        },
      });

      if (existingLoan) {
        const isSameRequest =
          existingLoan.organizationId === organizationId &&
          existingLoan.borrowerMembershipId === membership.id &&
          existingLoan.lendingOfferId === command.offerId &&
          existingLoan.principalAmountMinorUnits === command.amountMinorUnits;

        return isSameRequest
          ? ({
              kind: "ALREADY_CREATED",
              loan: toCreatedLoan(existingLoan),
            } as const)
          : ({ kind: "REQUEST_CONFLICT" } as const);
      }

      // Lock before checking mutable availability so concurrent borrowers
      // cannot both consume the same remaining offer liquidity.
      await transaction.$queryRaw`
        SELECT "id"
        FROM "LendingOffer"
        WHERE "id" = CAST(${command.offerId} AS UUID)
          AND "organizationId" = CAST(${organizationId} AS UUID)
        FOR UPDATE
      `;

      const offer = await transaction.lendingOffer.findFirst({
        where: {
          id: command.offerId,
          organizationId,
          lenderMembershipId: { not: membership.id },
          status: "ACTIVE",
          expiresAt: { gt: now },
          lenderMembership: { isActive: true, role: MembershipRole.EMPLOYEE },
        },
        select: { ...offerSelection, lenderMembershipId: true },
      });

      if (!offer) return { kind: "OFFER_NOT_AVAILABLE" } as const;

      if (
        command.amountMinorUnits < offer.minimumLoanAmountMinorUnits ||
        command.amountMinorUnits > offer.maximumLoanAmountMinorUnits
      ) {
        return { kind: "AMOUNT_OUT_OF_RANGE" } as const;
      }

      if (command.amountMinorUnits > offer.availableAmountMinorUnits) {
        return { kind: "INSUFFICIENT_LIQUIDITY" } as const;
      }

      const balances = await transaction.employeeBalance.findMany({
        where: {
          organizationId,
          membershipId: {
            in: [membership.id, offer.lenderMembershipId],
          },
          currency: offer.currency,
        },
        select: {
          id: true,
          membershipId: true,
          amountMinorUnits: true,
          currency: true,
        },
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
      const lenderBalance = lockedBalances.find(
        ({ membershipId }) => membershipId === offer.lenderMembershipId,
      );
      const borrowerBalance = lockedBalances.find(
        ({ membershipId }) => membershipId === membership.id,
      );

      if (!lenderBalance || !borrowerBalance) {
        return { kind: "BALANCE_UNAVAILABLE" } as const;
      }

      if (lenderBalance.amountMinorUnits < command.amountMinorUnits) {
        return { kind: "INSUFFICIENT_LIQUIDITY" } as const;
      }

      const summary = calculateBorrowLoanSummary(
        offer,
        command.amountMinorUnits,
        now,
      );
      const loan = await transaction.loan.create({
        data: {
          organizationId,
          lenderMembershipId: offer.lenderMembershipId,
          borrowerMembershipId: membership.id,
          lendingOfferId: offer.id,
          borrowRequestId: command.requestId,
          principalAmountMinorUnits: command.amountMinorUnits,
          feeAmountMinorUnits: summary.feeAmountMinorUnits,
          outstandingPrincipalMinorUnits: command.amountMinorUnits,
          currency: offer.currency,
          durationDays: offer.durationDays,
          feeRateBasisPoints: offer.feeRateBasisPoints,
          status: "ACTIVE",
          startedAt: now,
          repaymentDueAt: summary.repaymentDueAt,
        },
        select: createdLoanSelection,
      });

      await transaction.employeeBalance.update({
        where: { id: lenderBalance.id },
        data: { amountMinorUnits: { decrement: command.amountMinorUnits } },
      });
      await transaction.employeeBalance.update({
        where: { id: borrowerBalance.id },
        data: { amountMinorUnits: { increment: command.amountMinorUnits } },
      });

      const remainingLiquidity =
        offer.availableAmountMinorUnits - command.amountMinorUnits;
      await transaction.lendingOffer.update({
        where: { id: offer.id },
        data: {
          availableAmountMinorUnits: remainingLiquidity,
          ...(remainingLiquidity === 0n ? { status: "CLOSED" } : {}),
        },
      });

      const [borrowerAccount, lenderAccount] = await Promise.all([
        transaction.ledgerAccount.upsert({
          where: {
            organizationId_membershipId_currency_type: {
              organizationId,
              membershipId: membership.id,
              currency: offer.currency,
              type: "MOCK_CASH",
            },
          },
          update: {},
          create: {
            organizationId,
            membershipId: membership.id,
            currency: offer.currency,
            type: "MOCK_CASH",
          },
          select: { id: true },
        }),
        transaction.ledgerAccount.upsert({
          where: {
            organizationId_membershipId_currency_type: {
              organizationId,
              membershipId: offer.lenderMembershipId,
              currency: offer.currency,
              type: "MOCK_CASH",
            },
          },
          update: {},
          create: {
            organizationId,
            membershipId: offer.lenderMembershipId,
            currency: offer.currency,
            type: "MOCK_CASH",
          },
          select: { id: true },
        }),
      ]);

      const ledgerTransaction = await transaction.ledgerTransaction.create({
        data: {
          organizationId,
          loanId: loan.id,
          type: "LOAN_DISBURSEMENT",
          currency: offer.currency,
        },
        select: { id: true },
      });
      await transaction.ledgerEntry.createMany({
        data: [
          {
            organizationId,
            transactionId: ledgerTransaction.id,
            accountId: borrowerAccount.id,
            direction: "DEBIT",
            amountMinorUnits: command.amountMinorUnits,
            currency: offer.currency,
          },
          {
            organizationId,
            transactionId: ledgerTransaction.id,
            accountId: lenderAccount.id,
            direction: "CREDIT",
            amountMinorUnits: command.amountMinorUnits,
            currency: offer.currency,
          },
        ],
      });

      await transaction.auditEvent.create({
        data: {
          organizationId,
          loanId: loan.id,
          type: "LOAN_CREATED",
          title: "Loan terms agreed and funds disbursed",
          actorLabel: membership.user.name,
          occurredAt: now,
        },
      });

      return { kind: "CREATED", loan: toCreatedLoan(loan) } as const;
    });
  },
};
