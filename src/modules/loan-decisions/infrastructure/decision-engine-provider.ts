import type { LoanDecisionEngine } from "@/modules/loan-decisions/domain/loan-decision";
import { ModelDecisionAdapter } from "@/modules/loan-decisions/infrastructure/model-decision-adapter";
import { RuleBasedDecisionAdapter } from "@/modules/loan-decisions/infrastructure/rule-based-decision-adapter";

export type LoanDecisionProvider = "rules" | "model";

export function createLoanDecisionEngine(
  provider: LoanDecisionProvider,
): LoanDecisionEngine {
  return provider === "model"
    ? new ModelDecisionAdapter()
    : new RuleBasedDecisionAdapter();
}
