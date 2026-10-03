export type LoanDecisionClassification =
  "healthy" | "due_soon" | "overdue" | "default_candidate";

export type LoanDecisionRecommendedAction =
  "none" | "remind" | "flag_for_review" | "employer_review";

export type LoanDecisionReason =
  | "LOAN_CURRENT"
  | "LOAN_REPAID"
  | "DUE_WITHIN_3_DAYS"
  | "PAST_DUE"
  | "PAST_DUE_7_DAYS"
  | "EMPLOYEE_SUSPENDED"
  | "EMPLOYEE_TERMINATED";

export type LoanDecisionInput = Readonly<{
  loanId: string;
  principalBaseUnits: string;
  repaymentBaseUnits: string;
  startedAt: Date;
  dueAt: Date;
  currentTime: Date;
  borrower: Readonly<{
    employeeId: string;
    organizationId: string;
    employmentStatus: "active" | "suspended" | "terminated";
  }>;
  loanStatus: "active" | "repaid" | "overdue" | "defaulted";
}>;

export type LoanDecision = Readonly<{
  classification: LoanDecisionClassification;
  recommendedAction: LoanDecisionRecommendedAction;
  reasonCodes: ReadonlyArray<LoanDecisionReason>;
  source: "rules" | "model";
  evaluatedAt: Date;
  modelVersion?: string;
}>;

export interface LoanDecisionEngine {
  evaluate(input: LoanDecisionInput): Promise<LoanDecision>;
}

export class DecisionModelUnavailableError extends Error {
  constructor() {
    super("The configured loan decision model is not available.");
    this.name = "DecisionModelUnavailableError";
  }
}

export const loanDecisionLabels: Record<LoanDecisionClassification, string> = {
  healthy: "Healthy",
  due_soon: "Due Soon",
  overdue: "Overdue",
  default_candidate: "Needs Review",
};

export const loanDecisionActionLabels: Record<
  LoanDecisionRecommendedAction,
  string
> = {
  none: "No action",
  remind: "Reminder",
  flag_for_review: "Flag for review",
  employer_review: "Employer review",
};

export const loanDecisionReasonLabels: Record<LoanDecisionReason, string> = {
  LOAN_CURRENT: "Payment is on schedule",
  LOAN_REPAID: "Loan has been repaid",
  DUE_WITHIN_3_DAYS: "Payment is due within 3 days",
  PAST_DUE: "Payment is past due",
  PAST_DUE_7_DAYS: "Payment is more than 7 days overdue",
  EMPLOYEE_SUSPENDED: "Employee membership is suspended",
  EMPLOYEE_TERMINATED: "Employee is no longer active",
};

export function calculateDaysOverdue(dueAt: Date, currentTime: Date): number {
  const elapsed = currentTime.getTime() - dueAt.getTime();
  return elapsed <= 0 ? 0 : Math.ceil(elapsed / (24 * 60 * 60 * 1_000));
}
