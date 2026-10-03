import type { LoanDecisionClassification } from "@/modules/loan-decisions/domain/loan-decision";
import type {
  EmployerActionAttempt,
  EmployerActionProvider,
  EmployerActionResult,
  EmployerActionType,
} from "@/modules/employer-actions/domain/employer-action";

export type EmployerActionContext = Readonly<{
  evaluationId: string;
  classification: LoanDecisionClassification;
  financialStatus: string;
  reviewedAt: Date | null;
}>;

export type EmployerActionClaim =
  | Readonly<{ kind: "CLAIMED"; attempt: EmployerActionAttempt }>
  | Readonly<{ kind: "EXISTING"; attempt: EmployerActionAttempt }>;

export interface EmployerActionRepository {
  findContext(input: {
    organizationId: string;
    loanId: string;
    requestedByUserId: string;
  }): Promise<EmployerActionContext | null>;
  findByIdempotencyKey(input: {
    organizationId: string;
    idempotencyKey: string;
    requestedByUserId: string;
  }): Promise<EmployerActionAttempt | null>;
  claimAttempt(input: {
    organizationId: string;
    loanId: string;
    evaluationId: string;
    requestedByUserId: string;
    action: EmployerActionType;
    provider: EmployerActionProvider;
    idempotencyKey: string;
    requestedAt: Date;
  }): Promise<EmployerActionClaim | null>;
  completeAttempt(input: {
    organizationId: string;
    attemptId: string;
    result: EmployerActionResult;
    completedAt: Date;
  }): Promise<EmployerActionAttempt>;
  listForLoan(input: {
    organizationId: string;
    loanId: string;
    requestedByUserId: string;
  }): Promise<EmployerActionAttempt[] | null>;
}
