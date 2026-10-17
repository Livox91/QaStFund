import {
  evalScenarios,
  runEvalScenario,
} from "../../src/modules/repayment-agent/evals/scenarios.js";
import { createWorld } from "../../src/modules/repayment-agent/evals/sim-world.js";

const id = process.argv[2] ?? "demo-replan-after-balance-change";
const verbose = process.argv.includes("--verbose");
const scenario = evalScenarios.find((item) => item.id === id);
if (!scenario) {
  console.error(
    `Unknown scenario "${id}". Available:\n  ${evalScenarios.map((item) => item.id).join("\n  ")}`,
  );
  process.exit(1);
}

// Re-run the scenario against a world we can inspect afterwards.
const world = createWorld(scenario.world);
scenario.setup?.(world);
if (scenario.execute) await scenario.execute(world);
else await world.run();

console.log(`\n${scenario.title}\n${"=".repeat(scenario.title.length)}`);
for (const run of world.repository.runs.values()) {
  console.log(`\nRun ${run.id.slice(-6)} → ${run.status} (${run.outcomeCode})`);
  for (const step of run.steps) {
    console.log(
      `  ${String(step.sequence).padStart(2)} ${step.phase.padEnd(8)} ${step.name.padEnd(28)} ${step.summary}`,
    );
    if (verbose && step.phase !== "OBSERVE") {
      console.log(`       ${JSON.stringify(step.data).slice(0, 400)}`);
    }
  }
}
console.log("\nOn-chain transfers:");
for (const transfer of world.chain.transfers) {
  console.log(
    `  ${transfer.amountBaseUnits / 10_000n / 100n}.${String((transfer.amountBaseUnits / 10_000n) % 100n).padStart(2, "0")} USDC  borrower → lender of loan ${transfer.chainLoanId}`,
  );
}
console.log("\nNotifications:");
for (const notification of world.notifier.sent) {
  console.log(`  [${notification.kind}] ${notification.subject}`);
}
const result = await runEvalScenario(scenario);
console.log(
  `\nScore: ${result.passed ? "PASS" : "FAIL"} ${JSON.stringify(result.scores)}`,
);
