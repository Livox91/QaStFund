import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { LendingOfferNotFoundError } from "@/modules/lending/application/errors/lending-offer-errors";
import type { LendingOfferRepository } from "@/modules/lending/application/ports/lending-offer-repository";

export async function getLendingOffer(
  actor: AuthenticatedActor | null,
  offerId: string,
  repository: LendingOfferRepository,
  now = new Date(),
) {
  const employee = requireEmployee(actor);
  const offer = await repository.findForOrganization({
    organizationId: employee.organizationId,
    userId: employee.userId,
    offerId,
    now,
  });

  if (!offer) throw new LendingOfferNotFoundError();

  return offer;
}

export async function listActiveLendingOffers(
  actor: AuthenticatedActor | null,
  repository: LendingOfferRepository,
  now = new Date(),
) {
  const employee = requireEmployee(actor);
  const offers = await repository.listActiveForOrganization({
    organizationId: employee.organizationId,
    userId: employee.userId,
    now,
  });

  if (!offers) throw new LendingOfferNotFoundError();

  return offers;
}
