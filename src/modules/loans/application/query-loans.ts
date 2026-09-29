import {
  requireAuthenticatedUser,
  requireEmployee,
} from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { LoanNotFoundError } from "@/modules/loans/application/errors/borrow-loan-errors";
import type { LoanQueryRepository } from "@/modules/loans/application/ports/loan-query-repository";

export async function listBorrowedLoans(
  actor: AuthenticatedActor | null,
  repository: LoanQueryRepository,
) {
  const employee = requireEmployee(actor);
  const loans = await repository.listBorrowed({
    organizationId: employee.organizationId,
    userId: employee.userId,
  });

  if (!loans) throw new LoanNotFoundError();
  return loans;
}

export async function listFundedLoans(
  actor: AuthenticatedActor | null,
  repository: LoanQueryRepository,
) {
  const employee = requireEmployee(actor);
  const loans = await repository.listFunded({
    organizationId: employee.organizationId,
    userId: employee.userId,
  });

  if (!loans) throw new LoanNotFoundError();
  return loans;
}

export async function getAccessibleLoan(
  actor: AuthenticatedActor | null,
  loanId: string,
  repository: LoanQueryRepository,
) {
  const authenticated = requireAuthenticatedUser(actor);
  const loan = await repository.findAccessible({
    organizationId: authenticated.organizationId,
    userId: authenticated.userId,
    role: authenticated.role,
    loanId,
  });

  if (!loan) throw new LoanNotFoundError();
  return loan;
}
