import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { createLendingOffer } from "@/modules/lending/application/create-lending-offer";
import { getEmployeeLending } from "@/modules/lending/application/get-employee-lending";
import {
  getLendingOffer,
  listActiveLendingOffers,
} from "@/modules/lending/application/get-lending-offer";
import { getLendingMarketplace } from "@/modules/lending/application/get-lending-marketplace";
import { updateLendingOfferStatus } from "@/modules/lending/application/update-lending-offer-status";
import type {
  CreateLendingOfferCommand,
  LendingOfferManagementStatus,
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

export function listActiveLendingOffersForActor(
  actor: AuthenticatedActor | null,
  now = new Date(),
) {
  return listActiveLendingOffers(actor, prismaLendingOfferRepository, now);
}

export function getLendingOfferForActor(
  actor: AuthenticatedActor | null,
  offerId: string,
  now = new Date(),
) {
  return getLendingOffer(actor, offerId, prismaLendingOfferRepository, now);
}

export function updateLendingOfferStatusForActor(
  actor: AuthenticatedActor | null,
  offerId: string,
  status: LendingOfferManagementStatus,
  now = new Date(),
) {
  return updateLendingOfferStatus(
    actor,
    offerId,
    status,
    prismaLendingOfferRepository,
    now,
  );
}
