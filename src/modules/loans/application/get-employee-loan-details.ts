import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { EmployeeLoanNotFoundError } from "@/modules/loans/application/errors/repay-loan-errors";
import type { EmployeeLoanRepository } from "@/modules/loans/application/ports/employee-loan-repository";
import { toEmployeeBorrowedLoanDetails } from "@/modules/loans/domain/employee-loan";

export async function getEmployeeLoanDetails(
  actor: AuthenticatedActor | null,
  loanId: string,
  repository: EmployeeLoanRepository,
) {
  const employee = requireEmployee(actor);
  const loan = await repository.findBorrowedLoan({
    organizationId: employee.organizationId,
    userId: employee.userId,
    loanId,
  });

  if (!loan) throw new EmployeeLoanNotFoundError();

  return toEmployeeBorrowedLoanDetails(loan);
}
