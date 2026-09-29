import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  EmployeeLoanNotFoundError,
  InvalidRepaymentError,
  LoanNotRepayableError,
  RepaymentExceedsRemainingError,
  RepaymentRequestConflictError,
  InsufficientRepaymentBalanceError,
} from "@/modules/loans/application/errors/repay-loan-errors";
import type { EmployeeLoanRepository } from "@/modules/loans/application/ports/employee-loan-repository";
import type { RepayLoanCommand } from "@/modules/loans/domain/employee-loan";

export async function repayLoan(
  actor: AuthenticatedActor | null,
  command: RepayLoanCommand,
  repository: EmployeeLoanRepository,
  now = new Date(),
) {
  const employee = requireEmployee(actor);
  if (command.amountMinorUnits <= 0n) throw new InvalidRepaymentError();
  const result = await repository.repayBorrowedLoan({
    organizationId: employee.organizationId,
    userId: employee.userId,
    command,
    now,
  });

  switch (result.kind) {
    case "RECORDED":
    case "ALREADY_RECORDED":
      return result.repayment;
    case "LOAN_NOT_FOUND":
      throw new EmployeeLoanNotFoundError();
    case "LOAN_NOT_REPAYABLE":
      throw new LoanNotRepayableError();
    case "AMOUNT_EXCEEDS_REMAINING":
      throw new RepaymentExceedsRemainingError(
        result.remainingAmountMinorUnits,
        result.currency,
      );
    case "REQUEST_CONFLICT":
      throw new RepaymentRequestConflictError();
    case "INSUFFICIENT_BALANCE":
      throw new InsufficientRepaymentBalanceError();
  }
}
