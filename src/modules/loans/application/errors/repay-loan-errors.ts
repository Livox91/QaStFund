import { ApplicationError } from "@/shared/errors/application-error";

export class EmployeeLoanNotFoundError extends ApplicationError {
  constructor() {
    super("EMPLOYEE_LOAN_NOT_FOUND", "The loan was not found.", 404);
  }
}

export class LoanNotRepayableError extends ApplicationError {
  constructor() {
    super(
      "LOAN_NOT_REPAYABLE",
      "This loan is no longer eligible for repayment.",
      409,
    );
  }
}

export class RepaymentExceedsRemainingError extends ApplicationError {
  constructor(remainingAmountMinorUnits: bigint, currency: string) {
    const whole = remainingAmountMinorUnits / 100n;
    const fraction = (remainingAmountMinorUnits % 100n)
      .toString()
      .padStart(2, "0");
    super(
      "REPAYMENT_EXCEEDS_REMAINING",
      `The repayment cannot exceed the remaining balance of ${whole}.${fraction} ${currency}.`,
      422,
    );
  }
}

export class InvalidRepaymentError extends ApplicationError {
  constructor() {
    super("INVALID_REPAYMENT", "The repayment request is invalid.", 422);
  }
}

export class RepaymentRequestConflictError extends ApplicationError {
  constructor() {
    super(
      "REPAYMENT_REQUEST_CONFLICT",
      "This repayment request was already used for a different payment.",
      409,
    );
  }
}

export class InsufficientRepaymentBalanceError extends ApplicationError {
  constructor() {
    super(
      "INSUFFICIENT_REPAYMENT_BALANCE",
      "Your wallet does not have enough available USDC for this repayment.",
      409,
    );
  }
}
