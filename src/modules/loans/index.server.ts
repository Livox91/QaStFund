import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { borrowFromOffer } from "@/modules/loans/application/borrow-from-offer";
import { getBorrowableOffer } from "@/modules/loans/application/get-borrowable-offer";
import { getEmployerLoanDetails } from "@/modules/loans/application/get-employer-loan-details";
import { getEmployeeLoanDetails } from "@/modules/loans/application/get-employee-loan-details";
import { listEmployerLoans } from "@/modules/loans/application/list-employer-loans";
import { markOverdueLoans } from "@/modules/loans/application/mark-overdue-loans";
import {
  getAccessibleLoan,
  listBorrowedLoans,
  listFundedLoans,
} from "@/modules/loans/application/query-loans";
import { quoteBorrowFromOffer } from "@/modules/loans/application/quote-borrow-from-offer";
import { repayLoan } from "@/modules/loans/application/repay-loan";
import type { EmployerLoanFilter } from "@/modules/loans/domain/employer-loan";
import type { BorrowLoanCommand } from "@/modules/loans/domain/borrow-loan";
import type { RepayLoanCommand } from "@/modules/loans/domain/employee-loan";
import { prismaBorrowLoanRepository } from "@/modules/loans/infrastructure/prisma-borrow-loan-repository";
import { prismaEmployerLoanRepository } from "@/modules/loans/infrastructure/prisma-employer-loan-repository";
import { prismaEmployeeLoanRepository } from "@/modules/loans/infrastructure/prisma-employee-loan-repository";
import { prismaLoanQueryRepository } from "@/modules/loans/infrastructure/prisma-loan-query-repository";
import { prismaLoanLifecycleRepository } from "@/modules/loans/infrastructure/prisma-loan-lifecycle-repository";

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

export function quoteBorrowFromOfferForActor(
  actor: AuthenticatedActor,
  offerId: string,
  amountMinorUnits: bigint,
  now = new Date(),
) {
  return quoteBorrowFromOffer(
    actor,
    offerId,
    amountMinorUnits,
    prismaBorrowLoanRepository,
    now,
  );
}

export function listBorrowedLoansForActor(actor: AuthenticatedActor | null) {
  return listBorrowedLoans(actor, prismaLoanQueryRepository);
}

export function listFundedLoansForActor(actor: AuthenticatedActor | null) {
  return listFundedLoans(actor, prismaLoanQueryRepository);
}

export function getAccessibleLoanForActor(
  actor: AuthenticatedActor | null,
  loanId: string,
) {
  return getAccessibleLoan(actor, loanId, prismaLoanQueryRepository);
}

export function getEmployeeLoanDetailsForActor(
  actor: AuthenticatedActor,
  loanId: string,
) {
  return getEmployeeLoanDetails(actor, loanId, prismaEmployeeLoanRepository);
}

export function repayLoanForActor(
  actor: AuthenticatedActor,
  command: RepayLoanCommand,
  now = new Date(),
) {
  return repayLoan(actor, command, prismaEmployeeLoanRepository, now);
}

export function markOverdueLoansForActor(
  actor: AuthenticatedActor | null,
  now = new Date(),
) {
  return markOverdueLoans(actor, prismaLoanLifecycleRepository, now);
}
