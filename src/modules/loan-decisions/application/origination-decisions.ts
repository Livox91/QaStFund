import {
  requireEmployee,
  requireEmployerAdmin,
} from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  getEmployeeOriginationDecision,
  getEmployerOriginationDecision,
  findEmployerOriginationDecisionForLoan,
  listEmployerOriginationDecisions,
  overrideOriginationDecision,
} from "@/modules/loan-decisions/infrastructure/prisma-origination-decision-repository";
import { ApplicationError } from "@/shared/errors/application-error";

export async function getEmployeeOriginationDecisionForActor(
  actor: AuthenticatedActor | null,
  loanId: string,
) {
  const employee = requireEmployee(actor);
  const decision = await getEmployeeOriginationDecision({
    organizationId: employee.organizationId,
    userId: employee.userId,
    loanId,
  });
  if (!decision) {
    throw new ApplicationError(
      "LOAN_DECISION_NOT_FOUND",
      "Loan decision not found.",
      404,
    );
  }
  return decision;
}

export async function getEmployerOriginationDecisionForActor(
  actor: AuthenticatedActor | null,
  decisionId: string,
) {
  const employer = requireEmployerAdmin(actor);
  const decision = await getEmployerOriginationDecision({
    organizationId: employer.organizationId,
    decisionId,
  });
  if (!decision) {
    throw new ApplicationError(
      "LOAN_DECISION_NOT_FOUND",
      "Loan decision not found.",
      404,
    );
  }
  return decision;
}

export async function findEmployerOriginationDecisionForLoanForActor(
  actor: AuthenticatedActor | null,
  loanId: string,
) {
  const employer = requireEmployerAdmin(actor);
  return findEmployerOriginationDecisionForLoan({
    organizationId: employer.organizationId,
    loanId,
  });
}

export async function listEmployerOriginationDecisionsForActor(
  actor: AuthenticatedActor | null,
  status?: "APPROVAL_CONSIDERATION" | "REVIEW_REQUIRED" | "NOT_ELIGIBLE",
) {
  const employer = requireEmployerAdmin(actor);
  return listEmployerOriginationDecisions({
    organizationId: employer.organizationId,
    status,
  });
}

export async function overrideOriginationDecisionForActor(
  actor: AuthenticatedActor | null,
  input: {
    decisionId: string;
    outcome: "APPROVED" | "REJECTED";
    rationale: string;
  },
  now = new Date(),
) {
  const employer = requireEmployerAdmin(actor);
  const result = await overrideOriginationDecision({
    organizationId: employer.organizationId,
    reviewerUserId: employer.userId,
    ...input,
    reviewedAt: now,
  });
  if (!result) {
    throw new ApplicationError(
      "LOAN_DECISION_NOT_FOUND",
      "Loan decision not found.",
      404,
    );
  }
  return result;
}
