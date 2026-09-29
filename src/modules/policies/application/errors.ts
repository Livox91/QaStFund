import { ApplicationError } from "@/shared/errors/application-error";

export class InvalidLendingPolicyError extends ApplicationError {
  constructor() {
    super(
      "INVALID_LENDING_POLICY",
      "The lending policy values are invalid.",
      422,
    );
  }
}
export class LendingPolicyViolationError extends ApplicationError {
  constructor(public readonly violation: string) {
    super("LENDING_POLICY_VIOLATION", policyMessage(violation), 409);
  }
}
export class EmployeeLendingAccessNotFoundError extends ApplicationError {
  constructor() {
    super("EMPLOYEE_NOT_FOUND", "Employee was not found.", 404);
  }
}

function policyMessage(violation: string): string {
  const messages: Record<string, string> = {
    LENDING_DISABLED: "Lending is currently unavailable for this organization.",
    BORROWING_DISABLED:
      "Borrowing is currently unavailable for this organization.",
    EMPLOYEE_CANNOT_LEND: "Your lending access is currently disabled.",
    EMPLOYEE_CANNOT_BORROW: "Your borrowing access is currently disabled.",
    INTEREST_OUT_OF_RANGE:
      "The interest rate is outside the organization policy range.",
    TERM_OUT_OF_RANGE:
      "The loan term is outside the organization policy range.",
    MAX_LOAN_EXCEEDED:
      "The requested amount exceeds the organization loan limit.",
    OUTSTANDING_DEBT_EXCEEDED:
      "The requested amount exceeds your remaining debt capacity.",
    ACTIVE_LOAN_LIMIT_REACHED:
      "You have reached the maximum number of unresolved loans.",
  };
  return (
    messages[violation] ??
    "The operation is not allowed by organization policy."
  );
}
