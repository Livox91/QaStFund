import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { getEmployerLoanDetails } from "@/modules/loans/application/get-employer-loan-details";
import { listEmployerLoans } from "@/modules/loans/application/list-employer-loans";
import type { EmployerLoanFilter } from "@/modules/loans/domain/employer-loan";
import { prismaEmployerLoanRepository } from "@/modules/loans/infrastructure/prisma-employer-loan-repository";

export function listEmployerLoansForActor(
  actor: AuthenticatedActor,
  filter: EmployerLoanFilter,
) {
  return listEmployerLoans(actor, filter, prismaEmployerLoanRepository);
}

export function getEmployerLoanDetailsForActor(
  actor: AuthenticatedActor,
  loanId: string,
) {
  return getEmployerLoanDetails(actor, loanId, prismaEmployerLoanRepository);
}
