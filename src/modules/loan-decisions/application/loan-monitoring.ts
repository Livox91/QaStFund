import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { evaluateOrganizationLoans } from "@/modules/loan-decisions/application/evaluate-loan";
import type { LoanDecisionRepository } from "@/modules/loan-decisions/application/ports/loan-decision-repository";
import type { LoanDecisionEngine } from "@/modules/loan-decisions/domain/loan-decision";
import type { Clock } from "@/shared/time/clock";

export async function getLoanMonitoring(
  actor: AuthenticatedActor | null,
  engine: LoanDecisionEngine,
  repository: LoanDecisionRepository,
  clock: Clock,
) {
  const employer = requireEmployerAdmin(actor);
  await evaluateOrganizationLoans(actor, engine, repository, clock);
  return repository.listMonitoring(employer.organizationId);
}

export async function getLoanReview(
  actor: AuthenticatedActor | null,
  loanId: string,
  engine: LoanDecisionEngine,
  repository: LoanDecisionRepository,
  clock: Clock,
) {
  const employer = requireEmployerAdmin(actor);
  const candidate = await repository.findCandidate({
    organizationId: employer.organizationId,
    loanId,
  });
  if (!candidate) return null;
  const decision = await engine.evaluate({
    ...candidate,
    currentTime: clock.now(),
  });
  await repository.saveEvaluation({
    organizationId: employer.organizationId,
    loanId,
    decision,
  });
  return repository.findMonitoring({
    organizationId: employer.organizationId,
    loanId,
  });
}

export async function markLoanDecisionReviewed(
  actor: AuthenticatedActor | null,
  loanId: string,
  repository: LoanDecisionRepository,
  clock: Clock,
) {
  const employer = requireEmployerAdmin(actor);
  return repository.markReviewed({
    organizationId: employer.organizationId,
    loanId,
    reviewedByUserId: employer.userId,
    reviewedAt: clock.now(),
  });
}
