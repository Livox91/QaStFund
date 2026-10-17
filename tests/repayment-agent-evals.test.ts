import { describe, expect, it } from "vitest";

import {
  evalScenarios,
  runEvalScenario,
} from "@/modules/repayment-agent/evals/scenarios";

describe("repayment agent evaluations", () => {
  for (const scenario of evalScenarios) {
    it(scenario.title, async () => {
      const result = await runEvalScenario(scenario);
      expect(result.problems).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});
