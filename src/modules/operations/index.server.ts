import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { investigateLoanOperations } from "@/modules/operations/application/loan-investigation";
import { prismaLoanInvestigationRepository } from "@/modules/operations/infrastructure/prisma-loan-investigation-repository";

export function investigateLoanOperationsForActor(
  actor: AuthenticatedActor | null,
  loanId: string,
) {
  return investigateLoanOperations(
    actor,
    loanId,
    prismaLoanInvestigationRepository,
  );
}
