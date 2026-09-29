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

export class InsufficientLenderBalanceError extends ApplicationError {
  constructor() {
    super(
      "INSUFFICIENT_LENDER_BALANCE",
      "The lender does not have enough available USDC to fund this loan.",
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

export class InvalidBorrowRequestError extends ApplicationError {
  constructor() {
    super("INVALID_BORROW_REQUEST", "The borrow request is invalid.", 422);
  }
}

export class IdempotencyKeyRequiredError extends ApplicationError {
  constructor() {
    super(
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required.",
      400,
    );
  }
}

export class LoanNotFoundError extends ApplicationError {
  constructor() {
    super("LOAN_NOT_FOUND", "Loan was not found.", 404);
  }
}
