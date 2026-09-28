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
  constructor() {
    super(
      "REPAYMENT_EXCEEDS_REMAINING",
      "The repayment cannot exceed the remaining loan amount.",
      422,
    );
  }
}

export class InsufficientRepaymentBalanceError extends ApplicationError {
  constructor() {
    super(
      "INSUFFICIENT_REPAYMENT_BALANCE",
      "Your available mock balance is too low for this repayment.",
      422,
    );
  }
}

export class RepaymentBalanceUnavailableError extends ApplicationError {
  constructor() {
    super(
      "REPAYMENT_BALANCE_UNAVAILABLE",
      "The mock balances needed for this repayment are unavailable.",
      409,
    );
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
