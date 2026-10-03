import type {
  LoanDecision,
  LoanDecisionEngine,
  LoanDecisionInput,
  LoanDecisionReason,
} from "@/modules/loan-decisions/domain/loan-decision";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DUE_SOON_MS = 3 * DAY_MS;
const DEFAULT_CANDIDATE_MS = 7 * DAY_MS;

export class RuleBasedDecisionAdapter implements LoanDecisionEngine {
  async evaluate(input: LoanDecisionInput): Promise<LoanDecision> {
    const employmentReasons: LoanDecisionReason[] = [];
    if (input.borrower.employmentStatus === "suspended") {
      employmentReasons.push("EMPLOYEE_SUSPENDED");
    }
    if (input.borrower.employmentStatus === "terminated") {
      employmentReasons.push("EMPLOYEE_TERMINATED");
    }

    if (input.loanStatus === "repaid") {
      return {
        classification: "healthy",
        recommendedAction: "none",
        reasonCodes: ["LOAN_REPAID", ...employmentReasons],
        source: "rules",
        evaluatedAt: input.currentTime,
      };
    }

    const millisecondsPastDue =
      input.currentTime.getTime() - input.dueAt.getTime();
    if (millisecondsPastDue > DEFAULT_CANDIDATE_MS) {
      return {
        classification: "default_candidate",
        recommendedAction: "employer_review",
        reasonCodes: ["PAST_DUE_7_DAYS", ...employmentReasons],
        source: "rules",
        evaluatedAt: input.currentTime,
      };
    }
    if (millisecondsPastDue > 0) {
      return {
        classification: "overdue",
        recommendedAction: "flag_for_review",
        reasonCodes: ["PAST_DUE", ...employmentReasons],
        source: "rules",
        evaluatedAt: input.currentTime,
      };
    }
    if (millisecondsPastDue >= -DUE_SOON_MS) {
      return {
        classification: "due_soon",
        recommendedAction: "remind",
        reasonCodes: ["DUE_WITHIN_3_DAYS", ...employmentReasons],
        source: "rules",
        evaluatedAt: input.currentTime,
      };
    }
    return {
      classification: "healthy",
      recommendedAction: "none",
      reasonCodes: ["LOAN_CURRENT", ...employmentReasons],
      source: "rules",
      evaluatedAt: input.currentTime,
    };
  }
}
