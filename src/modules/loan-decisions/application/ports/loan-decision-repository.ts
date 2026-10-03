import type {
  LoanDecision,
  LoanDecisionClassification,
  LoanDecisionInput,
  LoanDecisionReason,
  LoanDecisionRecommendedAction,
} from "@/modules/loan-decisions/domain/loan-decision";

export type LoanDecisionCandidate = Omit<LoanDecisionInput, "currentTime">;

export type LoanDecisionEvaluationRecord = Readonly<{
  id: string;
  loanId: string;
  classification: LoanDecisionClassification;
  recommendedAction: LoanDecisionRecommendedAction;
  reasonCodes: ReadonlyArray<LoanDecisionReason>;
  source: "rules" | "model";
  modelVersion: string | null;
  evaluatedAt: Date;
}>;

export type LoanDecisionReviewRecord = Readonly<{
  id: string;
  classification: LoanDecisionClassification;
  reviewedAt: Date;
  reviewedByName: string;
}>;

export type LoanMonitoringRecord = Readonly<{
  loanId: string;
  borrowerName: string;
  lenderName: string;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  outstandingRepaymentMinorUnits: bigint;
  currency: string;
  dueAt: Date;
  financialStatus: string;
  evaluation: LoanDecisionEvaluationRecord;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  reviews: ReadonlyArray<LoanDecisionReviewRecord>;
}>;

export interface LoanDecisionRepository {
  listCandidates(organizationId: string): Promise<LoanDecisionCandidate[]>;
  listParticipantCandidates(input: {
    organizationId: string;
    userId: string;
  }): Promise<LoanDecisionCandidate[]>;
  findCandidate(input: {
    organizationId: string;
    loanId: string;
    borrowerUserId?: string;
  }): Promise<LoanDecisionCandidate | null>;
  saveEvaluation(input: {
    organizationId: string;
    decision: LoanDecision;
    loanId: string;
  }): Promise<LoanDecisionEvaluationRecord>;
  listMonitoring(organizationId: string): Promise<LoanMonitoringRecord[]>;
  findMonitoring(input: {
    organizationId: string;
    loanId: string;
  }): Promise<LoanMonitoringRecord | null>;
  markReviewed(input: {
    organizationId: string;
    loanId: string;
    reviewedByUserId: string;
    reviewedAt: Date;
  }): Promise<LoanMonitoringRecord | null>;
}
