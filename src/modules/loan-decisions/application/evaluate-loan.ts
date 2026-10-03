import {
  requireEmployee,
  requireEmployerAdmin,
} from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { LoanDecisionRepository } from "@/modules/loan-decisions/application/ports/loan-decision-repository";
import type {
  LoanDecision,
  LoanDecisionEngine,
} from "@/modules/loan-decisions/domain/loan-decision";
import type { Clock } from "@/shared/time/clock";

async function evaluateCandidate(
  organizationId: string,
  candidate: NonNullable<
    Awaited<ReturnType<LoanDecisionRepository["findCandidate"]>>
  >,
  engine: LoanDecisionEngine,
  repository: LoanDecisionRepository,
  clock: Clock,
): Promise<LoanDecision> {
  const decision = await engine.evaluate({
    ...candidate,
    currentTime: clock.now(),
  });
  await repository.saveEvaluation({
    organizationId,
    loanId: candidate.loanId,
    decision,
  });
  return decision;
}

export async function evaluateOrganizationLoans(
  actor: AuthenticatedActor | null,
  engine: LoanDecisionEngine,
  repository: LoanDecisionRepository,
  clock: Clock,
) {
  const employer = requireEmployerAdmin(actor);
  const candidates = await repository.listCandidates(employer.organizationId);
  return Promise.all(
    candidates.map((candidate) =>
      evaluateCandidate(
        employer.organizationId,
        candidate,
        engine,
        repository,
        clock,
      ),
    ),
  );
}

export async function evaluateBorrowerLoan(
  actor: AuthenticatedActor | null,
  loanId: string,
  engine: LoanDecisionEngine,
  repository: LoanDecisionRepository,
  clock: Clock,
) {
  const employee = requireEmployee(actor);
  const candidate = await repository.findCandidate({
    organizationId: employee.organizationId,
    loanId,
    borrowerUserId: employee.userId,
  });
  if (!candidate) return null;
  return evaluateCandidate(
    employee.organizationId,
    candidate,
    engine,
    repository,
    clock,
  );
}

export async function evaluateEmployeeLoans(
  actor: AuthenticatedActor | null,
  engine: LoanDecisionEngine,
  repository: LoanDecisionRepository,
  clock: Clock,
) {
  const employee = requireEmployee(actor);
  const candidates = await repository.listParticipantCandidates({
    organizationId: employee.organizationId,
    userId: employee.userId,
  });
  return Promise.all(
    candidates.map((candidate) =>
      evaluateCandidate(
        employee.organizationId,
        candidate,
        engine,
        repository,
        clock,
      ),
    ),
  );
}
