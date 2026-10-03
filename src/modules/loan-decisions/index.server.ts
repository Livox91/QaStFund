import "server-only";

import { validateEnvironment } from "@/infrastructure/config/environment";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  evaluateBorrowerLoan,
  evaluateEmployeeLoans,
} from "@/modules/loan-decisions/application/evaluate-loan";
import {
  getLoanMonitoring,
  getLoanReview,
  markLoanDecisionReviewed,
} from "@/modules/loan-decisions/application/loan-monitoring";
import { createLoanDecisionEngine } from "@/modules/loan-decisions/infrastructure/decision-engine-provider";
import { prismaLoanDecisionRepository } from "@/modules/loan-decisions/infrastructure/prisma-loan-decision-repository";
import { systemClock } from "@/shared/time/clock";

function configuredEngine() {
  return createLoanDecisionEngine(validateEnvironment().LOAN_DECISION_PROVIDER);
}

export function getLoanMonitoringForActor(actor: AuthenticatedActor | null) {
  return getLoanMonitoring(
    actor,
    configuredEngine(),
    prismaLoanDecisionRepository,
    systemClock,
  );
}

export function getLoanReviewForActor(
  actor: AuthenticatedActor | null,
  loanId: string,
) {
  return getLoanReview(
    actor,
    loanId,
    configuredEngine(),
    prismaLoanDecisionRepository,
    systemClock,
  );
}

export function evaluateBorrowerLoanForActor(
  actor: AuthenticatedActor | null,
  loanId: string,
) {
  return evaluateBorrowerLoan(
    actor,
    loanId,
    configuredEngine(),
    prismaLoanDecisionRepository,
    systemClock,
  );
}

export function evaluateEmployeeLoansForActor(
  actor: AuthenticatedActor | null,
) {
  return evaluateEmployeeLoans(
    actor,
    configuredEngine(),
    prismaLoanDecisionRepository,
    systemClock,
  );
}

export function markLoanDecisionReviewedForActor(
  actor: AuthenticatedActor | null,
  loanId: string,
) {
  return markLoanDecisionReviewed(
    actor,
    loanId,
    prismaLoanDecisionRepository,
    systemClock,
  );
}
