import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type { BorrowLoanRepository } from "@/modules/loans/application/ports/borrow-loan-repository";
import {
  ensureUserWallet,
  getCompletedAccountBalance,
  lockLedgerAccounts,
  postLedgerTransaction,
} from "@/modules/ledger/infrastructure/ledger-posting";
import {
  calculateBorrowLoanSummary,
  type BorrowableOffer,
  type CreatedBorrowingLoan,
} from "@/modules/loans/domain/borrow-loan";
import {
  policySnapshot,
  validateBorrowAgainstPolicy,
} from "@/modules/policies/domain/lending-policy";
import {
  calculateBorrowerObligations,
  ensureOrganizationPolicy,
} from "@/modules/policies/infrastructure/policy-data";

const offerSelection = {
  id: true,
  availableAmountMinorUnits: true,
  minimumLoanAmountMinorUnits: true,
  maximumLoanAmountMinorUnits: true,
  currency: true,
  durationDays: true,
  feeRateBasisPoints: true,
  expiresAt: true,
  lenderMembership: { select: { user: { select: { name: true } } } },
} as const;

const createdLoanSelection = {
  id: true,
  lendingOfferId: true,
  principalAmountMinorUnits: true,
  feeAmountMinorUnits: true,
  currency: true,
  durationDays: true,
  feeRateBasisPoints: true,
  activatedAt: true,
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
  activatedAt: Date | null;
  repaymentDueAt: Date;
};

function getPolicyForOfferRead(organizationId: string) {
  return prisma.$transaction((transaction) =>
    ensureOrganizationPolicy(transaction, organizationId),
  );
}

function toCreatedLoan(row: CreatedLoanRow): CreatedBorrowingLoan {
  if (!row.lendingOfferId) {
    throw new Error("Borrow request is not linked to a lending offer.");
  }

  if (!row.activatedAt) {
    throw new Error("Active borrow request has no activation timestamp.");
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
    activatedAt: row.activatedAt,
    repaymentDueAt: row.repaymentDueAt,
  };
}

export const prismaBorrowLoanRepository: BorrowLoanRepository = {
  async findBorrowableOffer({ organizationId, userId, offerId, now }) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, isActive: true, role: true, canBorrow: true },
    });

    if (!membership?.isActive || membership.role !== MembershipRole.EMPLOYEE) {
      return null;
    }

    if (!membership.canBorrow) return null;
    const policy = await getPolicyForOfferRead(organizationId);
    if (!policy.lendingEnabled || !policy.borrowingEnabled) return null;
    const offer = await prisma.lendingOffer.findFirst({
      where: {
        id: offerId,
        organizationId,
        lenderMembershipId: { not: membership.id },
        status: "ACTIVE",
        fundingStatus: "FUNDED",
        expiresAt: { gt: now },
        availableAmountMinorUnits: { gt: 0n },
        lenderMembership: {
          isActive: true,
          role: MembershipRole.EMPLOYEE,
          canLend: true,
        },
      },
      select: offerSelection,
    });
    return offer
      ? ({
          ...offer,
          lenderName: offer.lenderMembership.user.name,
        } as BorrowableOffer)
      : null;
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
          employmentStatus: true,
          role: true,
          canBorrow: true,
          user: { select: { name: true } },
        },
      });

      if (
        !membership?.isActive ||
        membership.employmentStatus !== "ACTIVE" ||
        membership.role !== MembershipRole.EMPLOYEE
      ) {
        return { kind: "OFFER_NOT_AVAILABLE" } as const;
      }

      await transaction.$queryRaw`
        SELECT "id" FROM "OrganizationMembership"
        WHERE "id" = CAST(${membership.id} AS UUID)
          AND "organizationId" = CAST(${organizationId} AS UUID)
        FOR UPDATE
      `;
      const borrowerAccess =
        await transaction.organizationMembership.findUnique({
          where: { id: membership.id },
          select: {
            isActive: true,
            employmentStatus: true,
            role: true,
            canBorrow: true,
          },
        });
      if (
        !borrowerAccess?.isActive ||
        borrowerAccess.employmentStatus !== "ACTIVE" ||
        borrowerAccess.role !== MembershipRole.EMPLOYEE
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

      const offer = await transaction.lendingOffer.findFirst({
        where: {
          id: command.offerId,
          organizationId,
          lenderMembershipId: { not: membership.id },
          status: "ACTIVE",
          fundingStatus: "LEGACY",
          expiresAt: { gt: now },
          lenderMembership: {
            isActive: true,
            employmentStatus: "ACTIVE",
            role: MembershipRole.EMPLOYEE,
            canLend: true,
          },
        },
        select: { ...offerSelection, lenderMembershipId: true },
      });

      if (!offer) return { kind: "OFFER_NOT_AVAILABLE" } as const;

      await transaction.$queryRaw`
        SELECT "id" FROM "OrganizationMembership"
        WHERE "id" = CAST(${offer.lenderMembershipId} AS UUID)
          AND "organizationId" = CAST(${organizationId} AS UUID)
        FOR SHARE
      `;
      const lenderAccess = await transaction.organizationMembership.findUnique({
        where: { id: offer.lenderMembershipId },
        select: { isActive: true, employmentStatus: true, canLend: true },
      });
      if (
        !lenderAccess?.isActive ||
        lenderAccess.employmentStatus !== "ACTIVE" ||
        !lenderAccess.canLend
      ) {
        return { kind: "OFFER_NOT_AVAILABLE" } as const;
      }

      const policy = await ensureOrganizationPolicy(
        transaction,
        organizationId,
      );
      await transaction.$queryRaw`SELECT "id" FROM "OrganizationLendingPolicy" WHERE "id" = CAST(${policy.id} AS UUID) FOR SHARE`;
      const lockedPolicy =
        await transaction.organizationLendingPolicy.findUniqueOrThrow({
          where: { id: policy.id },
        });
      const obligations = await calculateBorrowerObligations(
        transaction,
        organizationId,
        membership.id,
      );
      const policyViolation = validateBorrowAgainstPolicy(
        lockedPolicy,
        borrowerAccess,
        {
          amountMinorUnits: command.amountMinorUnits,
          ...obligations,
        },
      );
      if (policyViolation) {
        return {
          kind: "POLICY_VIOLATION",
          violation: policyViolation,
        } as const;
      }

      if (
        command.amountMinorUnits < offer.minimumLoanAmountMinorUnits ||
        command.amountMinorUnits > offer.maximumLoanAmountMinorUnits
      ) {
        return { kind: "AMOUNT_OUT_OF_RANGE" } as const;
      }

      if (command.amountMinorUnits > offer.availableAmountMinorUnits) {
        return { kind: "INSUFFICIENT_LIQUIDITY" } as const;
      }

      const [lenderWallet, borrowerWallet] = await Promise.all([
        ensureUserWallet(transaction, {
          organizationId,
          membershipId: offer.lenderMembershipId,
        }),
        ensureUserWallet(transaction, {
          organizationId,
          membershipId: membership.id,
        }),
      ]);
      await lockLedgerAccounts(transaction, organizationId, [
        lenderWallet.id,
        borrowerWallet.id,
      ]);
      const lenderBalance = await getCompletedAccountBalance(transaction, {
        organizationId,
        accountId: lenderWallet.id,
      });
      if (lenderBalance < command.amountMinorUnits) {
        return { kind: "INSUFFICIENT_LENDER_BALANCE" } as const;
      }

      // This conditional decrement is the double-spend boundary. PostgreSQL
      // reevaluates the predicate after waiting on a concurrent row update, so
      // no committed execution can make availability negative.
      const reservation = await transaction.lendingOffer.updateMany({
        where: {
          id: offer.id,
          organizationId,
          lenderMembershipId: offer.lenderMembershipId,
          status: "ACTIVE",
          expiresAt: { gt: now },
          availableAmountMinorUnits: { gte: command.amountMinorUnits },
          lenderMembership: {
            isActive: true,
            role: MembershipRole.EMPLOYEE,
          },
        },
        data: {
          availableAmountMinorUnits: { decrement: command.amountMinorUnits },
        },
      });

      if (reservation.count !== 1) {
        return { kind: "INSUFFICIENT_LIQUIDITY" } as const;
      }

      await transaction.lendingOffer.updateMany({
        where: {
          id: offer.id,
          organizationId,
          status: "ACTIVE",
          availableAmountMinorUnits: 0n,
        },
        data: { status: "EXHAUSTED" },
      });

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
          requestedAt: now,
          approvedAt: now,
          activatedAt: now,
          startedAt: now,
          repaymentDueAt: summary.repaymentDueAt,
          policyVersion: lockedPolicy.policyVersion,
          policySnapshot: policySnapshot(lockedPolicy),
        },
        select: createdLoanSelection,
      });

      await postLedgerTransaction(transaction, {
        organizationId,
        type: "LOAN_DISBURSEMENT",
        referenceType: "LOAN",
        referenceId: loan.id,
        idempotencyKey: `borrow:${command.requestId}`,
        now,
        accountsAlreadyLocked: true,
        entries: [
          {
            accountId: lenderWallet.id,
            direction: "DEBIT",
            amountMinorUnits: command.amountMinorUnits,
          },
          {
            accountId: borrowerWallet.id,
            direction: "CREDIT",
            amountMinorUnits: command.amountMinorUnits,
          },
        ],
      });

      await transaction.auditEvent.create({
        data: {
          organizationId,
          loanId: loan.id,
          lendingOfferId: offer.id,
          amountMinorUnits: command.amountMinorUnits,
          currency: offer.currency,
          type: "LOAN_CREATED",
          title: "Loan terms agreed and offer capital reserved",
          actorMembershipId: membership.id,
          actorLabel: membership.user.name,
          occurredAt: now,
        },
      });

      return { kind: "CREATED", loan: toCreatedLoan(loan) } as const;
    });
  },
};
