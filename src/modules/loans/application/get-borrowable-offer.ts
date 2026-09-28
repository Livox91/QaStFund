import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { LendingOfferNotAvailableError } from "@/modules/loans/application/errors/borrow-loan-errors";
import type { BorrowLoanRepository } from "@/modules/loans/application/ports/borrow-loan-repository";

export async function getBorrowableOffer(
  actor: AuthenticatedActor | null,
  offerId: string,
  repository: BorrowLoanRepository,
  now = new Date(),
) {
  const employee = requireEmployee(actor);
  const offer = await repository.findBorrowableOffer({
    organizationId: employee.organizationId,
    userId: employee.userId,
    offerId,
    now,
  });

  if (!offer) throw new LendingOfferNotAvailableError();

  return offer;
}
