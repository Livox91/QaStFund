import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { createLendingOffer } from "@/modules/lending/application/create-lending-offer";
import { getEmployeeLending } from "@/modules/lending/application/get-employee-lending";
import { getLendingMarketplace } from "@/modules/lending/application/get-lending-marketplace";
import type {
  CreateLendingOfferCommand,
  LendingMarketplaceFilters,
} from "@/modules/lending/domain/lending-offer";
import { prismaLendingOfferRepository } from "@/modules/lending/infrastructure/prisma-lending-offer-repository";

export function createLendingOfferForActor(
  actor: AuthenticatedActor,
  command: CreateLendingOfferCommand,
  now = new Date(),
) {
  return createLendingOffer(actor, command, prismaLendingOfferRepository, now);
}

export function getEmployeeLendingForActor(
  actor: AuthenticatedActor,
  now = new Date(),
) {
  return getEmployeeLending(actor, prismaLendingOfferRepository, now);
}

export function getLendingMarketplaceForActor(
  actor: AuthenticatedActor,
  filters: LendingMarketplaceFilters,
  now = new Date(),
) {
  return getLendingMarketplace(
    actor,
    filters,
    prismaLendingOfferRepository,
    now,
  );
}
