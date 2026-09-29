import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  InvalidLendingOfferStatusTransitionError,
  LendingOfferNotFoundError,
} from "@/modules/lending/application/errors/lending-offer-errors";
import type { LendingOfferRepository } from "@/modules/lending/application/ports/lending-offer-repository";
import {
  canChangeLendingOfferStatus,
  toPersistedLendingOfferStatus,
  type LendingOfferManagementStatus,
} from "@/modules/lending/domain/lending-offer";

export async function updateLendingOfferStatus(
  actor: AuthenticatedActor | null,
  offerId: string,
  targetStatus: LendingOfferManagementStatus,
  repository: LendingOfferRepository,
  now = new Date(),
) {
  const employee = requireEmployee(actor);
  const current = await repository.findForManagement({
    organizationId: employee.organizationId,
    userId: employee.userId,
    offerId,
    now,
  });

  if (current.kind === "NOT_FOUND") throw new LendingOfferNotFoundError();
  if (current.kind === "NOT_OWNER") throw new ForbiddenError();

  if (
    (targetStatus === "ACTIVE" &&
      current.offer.availableAmountMinorUnits <= 0n) ||
    !canChangeLendingOfferStatus(
      current.offer.status,
      targetStatus,
      current.offer.expiresAt,
      now,
    )
  ) {
    throw new InvalidLendingOfferStatusTransitionError();
  }

  const result = await repository.updateStatusIfCurrent({
    organizationId: employee.organizationId,
    userId: employee.userId,
    offerId,
    expectedStatus: toPersistedLendingOfferStatus(current.offer.status),
    targetStatus,
    now,
  });

  if (result.kind === "CONFLICT") {
    throw new InvalidLendingOfferStatusTransitionError();
  }

  return result.offer;
}
