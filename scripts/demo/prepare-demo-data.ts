import "dotenv/config";

import { spawnSync } from "node:child_process";

import { prisma } from "../../src/infrastructure/database/prisma";
import {
  DEMO_DATA_CONFIRMATION,
  requireSafeDemoEnvironment,
} from "./demo-environment";

type DemoDataCounts = {
  delinquencyCases: number;
  demoUsers: number;
  loans: number;
  offers: number;
  payrollProposals: number;
  repaymentPlans: number;
};

async function readDemoDataCounts(): Promise<DemoDataCounts> {
  const organization = await prisma.organization.findUnique({
    where: { slug: "acme-corp" },
    select: { id: true },
  });

  if (!organization) {
    return {
      delinquencyCases: 0,
      demoUsers: 0,
      loans: 0,
      offers: 0,
      payrollProposals: 0,
      repaymentPlans: 0,
    };
  }

  const [
    demoUsers,
    offers,
    loans,
    repaymentPlans,
    payrollProposals,
    delinquencyCases,
  ] = await Promise.all([
    prisma.user.count({ where: { email: { endsWith: "@acme.test" } } }),
    prisma.lendingOffer.count({
      where: { organizationId: organization.id },
    }),
    prisma.loan.count({ where: { organizationId: organization.id } }),
    prisma.loanRepaymentPlan.count({
      where: { organizationId: organization.id },
    }),
    prisma.payrollDeductionProposal.count({
      where: { organizationId: organization.id },
    }),
    prisma.delinquencyCase.count({
      where: { organizationId: organization.id },
    }),
  ]);

  return {
    delinquencyCases,
    demoUsers,
    loans,
    offers,
    payrollProposals,
    repaymentPlans,
  };
}

function isComplete(counts: DemoDataCounts): boolean {
  return (
    counts.demoUsers >= 4 &&
    counts.offers >= 3 &&
    counts.loans >= 6 &&
    counts.repaymentPlans >= 3 &&
    counts.payrollProposals >= 1 &&
    counts.delinquencyCases >= 1
  );
}

function printCounts(counts: DemoDataCounts): void {
  console.log("Local demo records:");
  console.log(`  users=${counts.demoUsers}`);
  console.log(`  offers=${counts.offers}`);
  console.log(`  loans=${counts.loans}`);
  console.log(`  repaymentPlans=${counts.repaymentPlans}`);
  console.log(`  payrollProposals=${counts.payrollProposals}`);
  console.log(`  delinquencyCases=${counts.delinquencyCases}`);
}

async function main(): Promise<void> {
  const target = requireSafeDemoEnvironment(process.env);
  const confirmation = process.argv.find((argument) =>
    argument.startsWith("--confirm="),
  );
  const checkOnly = process.argv.includes("--check");

  if (!checkOnly && confirmation !== `--confirm=${DEMO_DATA_CONFIRMATION}`) {
    throw new Error(
      `Refusing to write demo data. Re-run with --confirm=${DEMO_DATA_CONFIRMATION}.`,
    );
  }

  console.log(
    `Verified local demo target: ${target.databaseName} on ${target.databaseUrl.hostname}.`,
  );

  if (!checkOnly) {
    await prisma.$disconnect();
    const command =
      process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npm", "run", "prisma:seed"]
        : ["run", "prisma:seed"];
    const result = spawnSync(command, args, {
      env: process.env,
      stdio: "inherit",
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Demo seed failed with exit code ${result.status ?? 1}.`);
    }
  }

  const counts = await readDemoDataCounts();
  printCounts(counts);

  if (!isComplete(counts)) {
    throw new Error(
      checkOnly
        ? `Demo data is incomplete. Run npm run demo:data -- --confirm=${DEMO_DATA_CONFIRMATION}.`
        : "Demo data preparation completed but required records are missing.",
    );
  }

  console.log("Demo data is ready. Records are deterministic local fixtures.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Demo data failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
