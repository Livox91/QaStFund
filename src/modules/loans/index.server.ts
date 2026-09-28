import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { borrowFromOffer } from "@/modules/loans/application/borrow-from-offer";
import { getBorrowableOffer } from "@/modules/loans/application/get-borrowable-offer";
import { getEmployerLoanDetails } from "@/modules/loans/application/get-employer-loan-details";
import { listEmployerLoans } from "@/modules/loans/application/list-employer-loans";
import type { EmployerLoanFilter } from "@/modules/loans/domain/employer-loan";
import type { BorrowLoanCommand } from "@/modules/loans/domain/borrow-loan";
import { prismaBorrowLoanRepository } from "@/modules/loans/infrastructure/prisma-borrow-loan-repository";
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

export function getBorrowableOfferForActor(
  actor: AuthenticatedActor,
  offerId: string,
  now = new Date(),
) {
  return getBorrowableOffer(actor, offerId, prismaBorrowLoanRepository, now);
}

export function borrowFromOfferForActor(
  actor: AuthenticatedActor,
  command: BorrowLoanCommand,
  now = new Date(),
) {
  return borrowFromOffer(actor, command, prismaBorrowLoanRepository, now);
}
