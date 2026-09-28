import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type { LendingOfferRepository } from "@/modules/lending/application/ports/lending-offer-repository";
import {
  calculateAvailableMockBalance,
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
  status: "ACTIVE" | "PAUSED" | "CLOSED";
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
} as const;

function toOfferView(offer: OfferRow, now: Date): LendingOfferView {
  return {
    ...offer,
    status: getLendingOfferDisplayStatus(offer.status, offer.expiresAt, now),
  };
}

export const prismaLendingOfferRepository: LendingOfferRepository = {
  async createForEmployee({ command, now, organizationId, userId }) {
    return prisma.$transaction(async (transaction) => {
      const membership = await transaction.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { id: true, isActive: true, role: true },
      });

      if (
        !membership?.isActive ||
        membership.role !== MembershipRole.EMPLOYEE
      ) {
        return { kind: "MEMBERSHIP_NOT_FOUND" } as const;
      }

      const balance = await transaction.employeeBalance.findUnique({
        where: {
          organizationId_membershipId: {
            organizationId,
            membershipId: membership.id,
          },
        },
        select: { id: true, amountMinorUnits: true, currency: true },
      });

      if (!balance) {
        return {
          kind: "INSUFFICIENT_BALANCE",
          availableBalanceMinorUnits: 0n,
        } as const;
      }

      // Serialize offer creation per employee balance so two simultaneous
      // submissions cannot both spend the same mock funds.
      await transaction.$queryRaw`
        SELECT "id"
        FROM "EmployeeBalance"
        WHERE "id" = CAST(${balance.id} AS UUID)
        FOR UPDATE
      `;

      const committed = await transaction.lendingOffer.aggregate({
        where: {
          organizationId,
          lenderMembershipId: membership.id,
          currency: balance.currency,
          status: "ACTIVE",
          expiresAt: { gt: now },
        },
        _sum: { amountMinorUnits: true },
      });
      const availableBalanceMinorUnits = calculateAvailableMockBalance(
        balance.amountMinorUnits,
        committed._sum.amountMinorUnits ?? 0n,
      );

      if (command.amountMinorUnits > availableBalanceMinorUnits) {
        return {
          kind: "INSUFFICIENT_BALANCE",
          availableBalanceMinorUnits,
        } as const;
      }

      const offer = await transaction.lendingOffer.create({
        data: {
          organizationId,
          lenderMembershipId: membership.id,
          amountMinorUnits: command.amountMinorUnits,
          availableAmountMinorUnits: command.amountMinorUnits,
          minimumLoanAmountMinorUnits: command.minimumLoanAmountMinorUnits,
          maximumLoanAmountMinorUnits: command.maximumLoanAmountMinorUnits,
          currency: balance.currency,
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
        select: { id: true, isActive: true, role: true },
      });

      if (
        !membership?.isActive ||
        membership.role !== MembershipRole.EMPLOYEE
      ) {
        return null;
      }

      const balance = await transaction.employeeBalance.findUnique({
        where: {
          organizationId_membershipId: {
            organizationId,
            membershipId: membership.id,
          },
        },
        select: { amountMinorUnits: true, currency: true },
      });
      const organization = balance
        ? null
        : await transaction.organization.findUniqueOrThrow({
            where: { id: organizationId },
            select: { currency: true },
          });
      const currency = balance?.currency ?? organization!.currency;
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
          expiresAt: { gt: now },
        },
        _sum: { amountMinorUnits: true },
      });

      return {
        currency,
        mockBalanceMinorUnits: balance?.amountMinorUnits ?? 0n,
        committedBalanceMinorUnits: committed._sum.amountMinorUnits ?? 0n,
        offers: (offers as OfferRow[]).map((offer) => toOfferView(offer, now)),
      };
    });
  },

  async listMarketplace({ filters, now, organizationId, userId }) {
    return prisma.$transaction(async (transaction) => {
      const membership = await transaction.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { id: true, isActive: true, role: true },
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
          lenderMembershipId: { not: membership.id },
          status: "ACTIVE",
          expiresAt: { gt: now },
          availableAmountMinorUnits: { gt: 0n },
          lenderMembership: { isActive: true, role: "EMPLOYEE" },
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
};
