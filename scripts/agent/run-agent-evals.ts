import {
  evalScenarios,
  runEvalScenario,
  type EvalDimension,
} from "../../src/modules/repayment-agent/evals/scenarios.js";

const dimensions: EvalDimension[] = [
  "policyCompliance",
  "correctAction",
  "noUnauthorizedTransfers",
  "noDuplicateExecution",
  "explanationCompleteness",
  "recoveryOrEscalation",
];

const results = [];
for (const scenario of evalScenarios) {
  results.push(await runEvalScenario(scenario));
}

console.log("\nQastFund repayment agent — evaluation scorecard\n");
for (const result of results) {
  console.log(
    `${result.passed ? "PASS" : "FAIL"}  ${result.title.padEnd(72)} ${result.actions.join(" → ") || "(no action)"}  [${result.finalStatus}/${result.finalOutcome}]`,
  );
  for (const problem of result.problems) console.log(`      ${problem}`);
}
console.log("\nBy dimension:");
for (const dimension of dimensions) {
  const passed = results.filter((result) => result.scores[dimension]).length;
  console.log(`  ${dimension.padEnd(26)} ${passed}/${results.length}`);
}
const total = results.filter((result) => result.passed).length;
console.log(`\nScenarios passed: ${total}/${results.length}\n`);
process.exitCode = total === results.length ? 0 : 1;
