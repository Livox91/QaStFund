import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  BorrowAmountOutOfRangeError,
  BorrowRequestConflictError,
  InsufficientOfferLiquidityError,
  InsufficientLenderBalanceError,
  InvalidBorrowRequestError,
  LendingOfferNotAvailableError,
} from "@/modules/loans/application/errors/borrow-loan-errors";
import type { BorrowLoanRepository } from "@/modules/loans/application/ports/borrow-loan-repository";
import type { BorrowLoanCommand } from "@/modules/loans/domain/borrow-loan";
import { LendingPolicyViolationError } from "@/modules/policies/application/errors";

export async function borrowFromOffer(
  actor: AuthenticatedActor | null,
  command: BorrowLoanCommand,
  repository: BorrowLoanRepository,
  now = new Date(),
) {
  const employee = requireEmployee(actor);
  if (command.amountMinorUnits <= 0n) throw new InvalidBorrowRequestError();
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
    case "INSUFFICIENT_LENDER_BALANCE":
      throw new InsufficientLenderBalanceError();
    case "POLICY_VIOLATION":
      throw new LendingPolicyViolationError(result.violation);
    case "REQUEST_CONFLICT":
      throw new BorrowRequestConflictError();
  }
}
