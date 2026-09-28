import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  BorrowAmountOutOfRangeError,
  BorrowingBalanceUnavailableError,
  BorrowRequestConflictError,
  InsufficientOfferLiquidityError,
  LendingOfferNotAvailableError,
} from "@/modules/loans/application/errors/borrow-loan-errors";
import type { BorrowLoanRepository } from "@/modules/loans/application/ports/borrow-loan-repository";
import type { BorrowLoanCommand } from "@/modules/loans/domain/borrow-loan";

export async function borrowFromOffer(
  actor: AuthenticatedActor | null,
  command: BorrowLoanCommand,
  repository: BorrowLoanRepository,
  now = new Date(),
) {
  const employee = requireEmployee(actor);
  const result = await repository.createFromOffer({
    organizationId: employee.organizationId,
    userId: employee.userId,
    command,
    now,
  });

  switch (result.kind) {
    case "CREATED":
    case "ALREADY_CREATED":
      return result.loan;
    case "OFFER_NOT_AVAILABLE":
      throw new LendingOfferNotAvailableError();
    case "AMOUNT_OUT_OF_RANGE":
      throw new BorrowAmountOutOfRangeError();
    case "INSUFFICIENT_LIQUIDITY":
      throw new InsufficientOfferLiquidityError();
    case "BALANCE_UNAVAILABLE":
      throw new BorrowingBalanceUnavailableError();
    case "REQUEST_CONFLICT":
      throw new BorrowRequestConflictError();
  }
}
