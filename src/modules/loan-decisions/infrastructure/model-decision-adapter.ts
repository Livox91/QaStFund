import {
  DecisionModelUnavailableError,
  type LoanDecisionEngine,
  type LoanDecisionInput,
} from "@/modules/loan-decisions/domain/loan-decision";

export class ModelDecisionAdapter implements LoanDecisionEngine {
  async evaluate(_input: LoanDecisionInput): Promise<never> {
    void _input;
    throw new DecisionModelUnavailableError();
  }
}
