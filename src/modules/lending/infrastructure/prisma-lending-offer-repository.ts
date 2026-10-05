import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type { LendingOfferRepository } from "@/modules/lending/application/ports/lending-offer-repository";
import {
  ensureUserWallet,
  getCompletedAccountBalance,
} from "@/modules/ledger/infrastructure/ledger-posting";
import { validateOfferAgainstPolicy } from "@/modules/policies/domain/lending-policy";
import { ensureOrganizationPolicy } from "@/modules/policies/infrastructure/policy-data";
import {
  getLendingOfferDisplayStatus,
  LendingMarketplaceSort,
  type LendingOfferView,
} from "@/modules/lending/domain/lending-offer";

type OfferRow = {
  id: string;
  amountMinorUnits: bigint;
  availableAmountMinorUnits: bigint;
  minimumLoanAmountMinorUnits: bigint;
  maximumLoanAmountMinorUnits: bigint;
  currency: string;
  durationDays: number;
  feeRateBasisPoints: number;
  expiresAt: Date;
  createdAt: Date;
  status: "ACTIVE" | "PAUSED" | "CLOSED" | "EXHAUSTED";
  fundingStatus: "LEGACY" | "PENDING" | "FUNDED" | "FAILED";
  fundingTransactionHash: string | null;
  chainOfferId: string | null;
  lenderMembership: { user: { id: string; name: string } };
};

const offerSelection = {
  id: true,
  amountMinorUnits: true,
  availableAmountMinorUnits: true,
  minimumLoanAmountMinorUnits: true,
  maximumLoanAmountMinorUnits: true,
  currency: true,
  durationDays: true,
  feeRateBasisPoints: true,
  expiresAt: true,
  createdAt: true,
  status: true,
  fundingStatus: true,
  fundingTransactionHash: true,
  chainOfferId: true,
  lenderMembership: {
    select: { user: { select: { id: true, name: true } } },
  },
} as const;

function toOfferView(offer: OfferRow, now: Date): LendingOfferView {
  return {
    id: offer.id,
    lender: {
      id: offer.lenderMembership.user.id,
      name: offer.lenderMembership.user.name,
    },
    amountMinorUnits: offer.amountMinorUnits,
    availableAmountMinorUnits: offer.availableAmountMinorUnits,
    minimumLoanAmountMinorUnits: offer.minimumLoanAmountMinorUnits,
    maximumLoanAmountMinorUnits: offer.maximumLoanAmountMinorUnits,
    currency: offer.currency,
    durationDays: offer.durationDays,
    feeRateBasisPoints: offer.feeRateBasisPoints,
    expiresAt: offer.expiresAt,
    createdAt: offer.createdAt,
    status: getLendingOfferDisplayStatus(offer.status, offer.expiresAt, now),
    fundingStatus: offer.fundingStatus,
    fundingTransactionHash: offer.fundingTransactionHash,
    chainOfferId: offer.chainOfferId,
  };
}

export const prismaLendingOfferRepository: LendingOfferRepository = {
  async createForEmployee({ command, now, organizationId, userId }) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "OrganizationMembership"
        WHERE "organizationId" = CAST(${organizationId} AS UUID)
          AND "userId" = CAST(${userId} AS UUID)
        FOR SHARE
      `;
      const membership = await transaction.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: {
          id: true,
          isActive: true,
          employmentStatus: true,
          role: true,
          canLend: true,
          organization: { select: { currency: true } },
        },
      });

      if (
        !membership?.isActive ||
        membership.employmentStatus !== "ACTIVE" ||
        membership.role !== MembershipRole.EMPLOYEE
      ) {
        return { kind: "MEMBERSHIP_NOT_FOUND" } as const;
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
      const violation = validateOfferAgainstPolicy(
        lockedPolicy,
        membership,
        command,
      );
      if (violation) return { kind: "POLICY_VIOLATION", violation } as const;

      const offer = await transaction.lendingOffer.create({
        data: {
          organizationId,
          lenderMembershipId: membership.id,
          amountMinorUnits: command.amountMinorUnits,
          availableAmountMinorUnits: command.amountMinorUnits,
          minimumLoanAmountMinorUnits: command.minimumLoanAmountMinorUnits,
          maximumLoanAmountMinorUnits: command.maximumLoanAmountMinorUnits,
          currency: membership.organization.currency,
          durationDays: command.durationDays,
          feeRateBasisPoints: command.feeRateBasisPoints,
          expiresAt: command.expiresAt,
          status: "ACTIVE",
        },
        select: offerSelection,
      });

      return { kind: "CREATED", offer: toOfferView(offer, now) } as const;
    });
  },

  async listForEmployee({ now, organizationId, userId }) {
    return prisma.$transaction(async (transaction) => {
      const membership = await transaction.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { id: true, isActive: true, role: true, canBorrow: true },
      });

      if (
        !membership?.isActive ||
        membership.role !== MembershipRole.EMPLOYEE
      ) {
        return null;
      }

      const organization = await transaction.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { currency: true },
      });
      const wallet = await ensureUserWallet(transaction, {
        organizationId,
        membershipId: membership.id,
      });
      const walletBalanceMinorUnits = await getCompletedAccountBalance(
        transaction,
        { organizationId, accountId: wallet.id },
      );
      const currency = organization.currency;
      const offers = await transaction.lendingOffer.findMany({
        where: { organizationId, lenderMembershipId: membership.id },
        orderBy: { createdAt: "desc" },
        select: offerSelection,
      });
      const committed = await transaction.lendingOffer.aggregate({
        where: {
          organizationId,
          lenderMembershipId: membership.id,
          currency,
          status: "ACTIVE",
          fundingStatus: "FUNDED",
          expiresAt: { gt: now },
        },
        _sum: { availableAmountMinorUnits: true },
      });

      return {
        currency,
        mockBalanceMinorUnits: walletBalanceMinorUnits,
        committedBalanceMinorUnits:
          committed._sum.availableAmountMinorUnits ?? 0n,
        offers: (offers as OfferRow[]).map((offer) => toOfferView(offer, now)),
      };
    });
  },

  async listMarketplace({ filters, now, organizationId, userId }) {
    return prisma.$transaction(async (transaction) => {
      const membership = await transaction.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: {
          id: true,
          isActive: true,
          employmentStatus: true,
          role: true,
          canBorrow: true,
        },
      });

      if (
        !membership?.isActive ||
        membership.role !== MembershipRole.EMPLOYEE
      ) {
        return null;
      }

      const organization = await transaction.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { currency: true },
      });
      const policy = await ensureOrganizationPolicy(
        transaction,
        organizationId,
      );
      if (
        !policy.lendingEnabled ||
        !policy.borrowingEnabled ||
        membership.employmentStatus !== "ACTIVE" ||
        !membership.canBorrow
      ) {
        return { currency: organization.currency, offers: [] };
      }
      const orderBy =
        filters.sort === LendingMarketplaceSort.MOST_AVAILABLE
          ? [{ availableAmountMinorUnits: "desc" as const }]
          : filters.sort === LendingMarketplaceSort.SHORTEST_DURATION
            ? [{ durationDays: "asc" as const }]
            : filters.sort === LendingMarketplaceSort.EXPIRING_SOON
              ? [{ expiresAt: "asc" as const }]
              : [
                  { feeRateBasisPoints: "asc" as const },
                  { availableAmountMinorUnits: "desc" as const },
                ];
      const offers = await transaction.lendingOffer.findMany({
        where: {
          organizationId,
          currency: organization.currency,
          status: "ACTIVE",
          fundingStatus: "FUNDED",
          lenderMembershipId: { not: membership.id },
          expiresAt: { gt: now },
          availableAmountMinorUnits: { gt: 0n },
          lenderMembership: {
            isActive: true,
            employmentStatus: "ACTIVE",
            role: "EMPLOYEE",
            canLend: true,
          },
          ...(filters.amountMinorUnits
            ? {
                minimumLoanAmountMinorUnits: {
                  lte: filters.amountMinorUnits,
                },
                maximumLoanAmountMinorUnits: {
                  gte: filters.amountMinorUnits,
                },
                availableAmountMinorUnits: {
                  gte: filters.amountMinorUnits,
                },
              }
            : {}),
          ...(filters.maximumDurationDays
            ? { durationDays: { lte: filters.maximumDurationDays } }
            : {}),
        },
        orderBy,
        select: offerSelection,
      });

      return {
        currency: organization.currency,
        offers: (offers as OfferRow[]).map((offer) => toOfferView(offer, now)),
      };
    });
  },

  async listActiveForOrganization({ now, organizationId, userId }) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        id: true,
        isActive: true,
        employmentStatus: true,
        role: true,
        canBorrow: true,
      },
    });

    if (
      !membership?.isActive ||
      membership.employmentStatus !== "ACTIVE" ||
      membership.role !== MembershipRole.EMPLOYEE
    ) {
      return null;
    }
    const policy = await prisma.$transaction((transaction) =>
      ensureOrganizationPolicy(transaction, organizationId),
    );
    if (
      !policy.lendingEnabled ||
      !policy.borrowingEnabled ||
      !membership.canBorrow
    )
      return [];

    const offers = await prisma.lendingOffer.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        fundingStatus: "FUNDED",
        lenderMembershipId: { not: membership.id },
        expiresAt: { gt: now },
        availableAmountMinorUnits: { gt: 0n },
        lenderMembership: {
          isActive: true,
          employmentStatus: "ACTIVE",
          role: MembershipRole.EMPLOYEE,
          canLend: true,
        },
      },
      orderBy: { createdAt: "desc" },
      select: offerSelection,
    });

    return (offers as OfferRow[]).map((offer) => toOfferView(offer, now));
  },

  async findForOrganization({ offerId, now, organizationId, userId }) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { isActive: true, employmentStatus: true, role: true },
    });

    if (
      !membership?.isActive ||
      membership.employmentStatus !== "ACTIVE" ||
      membership.role !== MembershipRole.EMPLOYEE
    ) {
      return null;
    }

    const offer = await prisma.lendingOffer.findFirst({
      where: { id: offerId, organizationId, fundingStatus: "FUNDED" },
      select: offerSelection,
    });

    return offer ? toOfferView(offer as OfferRow, now) : null;
  },

  async findForManagement({ offerId, now, organizationId, userId }) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, isActive: true, role: true },
    });

    if (!membership?.isActive || membership.role !== MembershipRole.EMPLOYEE) {
      return { kind: "NOT_FOUND" } as const;
    }

    const offer = await prisma.lendingOffer.findFirst({
      where: { id: offerId, organizationId },
      select: { ...offerSelection, lenderMembershipId: true },
    });

    if (!offer) return { kind: "NOT_FOUND" } as const;
    if (offer.lenderMembershipId !== membership.id) {
      return { kind: "NOT_OWNER" } as const;
    }

    return {
      kind: "FOUND",
      offer: toOfferView(offer as OfferRow, now),
    } as const;
  },

  async updateStatusIfCurrent({
    expectedStatus,
    offerId,
    now,
    organizationId,
    targetStatus,
    userId,
  }) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, isActive: true, role: true },
    });

    if (!membership?.isActive || membership.role !== MembershipRole.EMPLOYEE) {
      return { kind: "CONFLICT" } as const;
    }

    const updated = await prisma.lendingOffer.updateMany({
      where: {
        id: offerId,
        organizationId,
        lenderMembershipId: membership.id,
        fundingStatus: "LEGACY",
        status: expectedStatus,
        ...(targetStatus === "ACTIVE"
          ? {
              availableAmountMinorUnits: { gt: 0n },
              expiresAt: { gt: now },
            }
          : {}),
      },
      data: { status: targetStatus },
    });

    if (updated.count !== 1) return { kind: "CONFLICT" } as const;

    const offer = await prisma.lendingOffer.findUniqueOrThrow({
      where: { id: offerId },
      select: offerSelection,
    });

    return {
      kind: "UPDATED",
      offer: toOfferView(offer as OfferRow, now),
    } as const;
  },
};
