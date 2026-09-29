import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  BorrowAmountOutOfRangeError,
  InsufficientOfferLiquidityError,
  LendingOfferNotAvailableError,
} from "@/modules/loans/application/errors/borrow-loan-errors";
import type { BorrowLoanRepository } from "@/modules/loans/application/ports/borrow-loan-repository";
import {
  calculateBorrowLoanSummary,
  type BorrowLoanQuote,
} from "@/modules/loans/domain/borrow-loan";

export async function quoteBorrowFromOffer(
  actor: AuthenticatedActor | null,
  offerId: string,
  amountMinorUnits: bigint,
  repository: BorrowLoanRepository,
  now = new Date(),
): Promise<BorrowLoanQuote> {
  const employee = requireEmployee(actor);
  const offer = await repository.findBorrowableOffer({
    organizationId: employee.organizationId,
    userId: employee.userId,
    offerId,
    now,
  });

  if (!offer) throw new LendingOfferNotAvailableError();
  if (
    amountMinorUnits <= 0n ||
    amountMinorUnits < offer.minimumLoanAmountMinorUnits ||
    amountMinorUnits > offer.maximumLoanAmountMinorUnits
  ) {
    throw new BorrowAmountOutOfRangeError();
  }
  if (amountMinorUnits > offer.availableAmountMinorUnits) {
    throw new InsufficientOfferLiquidityError();
  }

  return {
    ...calculateBorrowLoanSummary(offer, amountMinorUnits, now),
    currency: offer.currency,
    durationDays: offer.durationDays,
    feeRateBasisPoints: offer.feeRateBasisPoints,
  };
}
