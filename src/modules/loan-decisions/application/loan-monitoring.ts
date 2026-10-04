import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { LoanDecisionRepository } from "@/modules/loan-decisions/application/ports/loan-decision-repository";
import type { LoanDecisionEngine } from "@/modules/loan-decisions/domain/loan-decision";
import type { Clock } from "@/shared/time/clock";

export async function getLoanMonitoring(
  actor: AuthenticatedActor | null,
  _engine: LoanDecisionEngine,
  repository: LoanDecisionRepository,
  _clock: Clock,
) {
  void _clock;
  const employer = requireEmployerAdmin(actor);
  return repository.listMonitoring(employer.organizationId);
}

export async function getLoanReview(
  actor: AuthenticatedActor | null,
  loanId: string,
  _engine: LoanDecisionEngine,
  repository: LoanDecisionRepository,
  _clock: Clock,
) {
  void _clock;
  const employer = requireEmployerAdmin(actor);
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
