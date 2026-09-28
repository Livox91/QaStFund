import { ApplicationError } from "@/shared/errors/application-error";

export class LendingOfferNotAvailableError extends ApplicationError {
  constructor() {
    super(
      "LENDING_OFFER_NOT_AVAILABLE",
      "This lending offer is no longer available.",
      404,
    );
  }
}

export class BorrowAmountOutOfRangeError extends ApplicationError {
  constructor() {
    super(
      "BORROW_AMOUNT_OUT_OF_RANGE",
      "The amount must be within the offer's current borrowing limits.",
      422,
    );
  }
}

export class InsufficientOfferLiquidityError extends ApplicationError {
  constructor() {
    super(
      "INSUFFICIENT_OFFER_LIQUIDITY",
      "The offer no longer has enough available liquidity.",
      409,
    );
  }
}

export class BorrowingBalanceUnavailableError extends ApplicationError {
  constructor() {
    super(
      "BORROWING_BALANCE_UNAVAILABLE",
      "The mock balance needed for this loan is unavailable.",
      409,
    );
  }
}

export class BorrowRequestConflictError extends ApplicationError {
  constructor() {
    super(
      "BORROW_REQUEST_CONFLICT",
      "This confirmation request was already used for a different loan.",
      409,
    );
  }
}
