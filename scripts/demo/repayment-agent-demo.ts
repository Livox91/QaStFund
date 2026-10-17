/**
 * End-to-end repayment agent demo against the real EmployeeLendingEscrowV3
 * contract on an in-process Hardhat chain. No database, Circle or Arc access
 * is needed. Set OPENAI_API_KEY and OPENAI_MODEL to plan with the model;
 * otherwise the deterministic planner decides.
 *
 *   npm run agent:demo
 */
import "dotenv/config";

import { network } from "hardhat";
import {
  createWalletClient,
  custom,
  keccak256,
  parseEther,
  stringToHex,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { FallbackPlanner } from "@/modules/repayment-agent/application/planner";
import { runRepaymentAgent } from "@/modules/repayment-agent/application/run-repayment-agent";
import { verifyRepaymentLogs } from "@/modules/repayment-agent/domain/receipt-verification";
import {
  InMemoryRepaymentAgentRepository,
  MutableClock,
  RecordingNotifier,
  StaticReconciliationHealth,
} from "@/modules/repayment-agent/evals/sim-world";
import { OpenAiRepaymentPlanner } from "@/modules/repayment-agent/infrastructure/openai-planner";
import { RuleBasedRepaymentPlanner } from "@/modules/repayment-agent/infrastructure/rule-based-planner";
import { ViemRepaymentGateway } from "@/modules/repayment-agent/infrastructure/viem-repayment-gateway";
import { formatUsdc } from "@/shared/money/usdc";

const USDC = 1_000_000n;
const DAY = 86_400n;
const show = (value: bigint) => `${formatUsdc(value)} USDC`;

const connection = await network.create();
const { viem, networkHelpers } = connection;
const publicClient = await viem.getPublicClient();
const [lender, borrower, authorizer, merchant] = await viem.getWalletClients();
// Like production, the agent signs locally with its own key and pays its own gas.
const agent = createWalletClient({
  account: privateKeyToAccount(generatePrivateKey()),
  chain: publicClient.chain,
  transport: custom(connection.provider),
});
await networkHelpers.setBalance(agent.account.address, parseEther("1"));
const chainId = await publicClient.getChainId();

console.log(
  "\n▶ Deploying MockUSDC and EmployeeLendingEscrowV3 on a local chain…",
);
const usdc = await viem.deployContract("MockUSDC");
const escrow = await viem.deployContract("EmployeeLendingEscrowV3", [
  usdc.address,
  authorizer.account.address,
]);

async function now() {
  return (await publicClient.getBlock()).timestamp;
}

async function fundLoan(
  principal: bigint,
  interestBps: bigint,
  duration: bigint,
  label: string,
) {
  await usdc.write.mint([lender.account.address, principal]);
  await usdc.write.approve([escrow.address, principal], {
    account: lender.account,
  });
  await escrow.write.createOffer(
    [principal, interestBps, duration, keccak256(stringToHex(label))],
    {
      account: lender.account,
    },
  );
  const offerId = (await escrow.read.nextOfferId()) - 1n;
  const expiry = (await now()) + 3_600n;
  const authorizationId = keccak256(stringToHex(`auth-${label}`));
  const signature = await authorizer.signTypedData({
    account: authorizer.account,
    domain: {
      name: "EmployeeLendingEscrow",
      version: "1",
      chainId,
      verifyingContract: escrow.address,
    },
    types: {
      BorrowAuthorization: [
        { name: "offerId", type: "uint256" },
        { name: "borrower", type: "address" },
        { name: "expiry", type: "uint256" },
        { name: "authorizationId", type: "bytes32" },
      ],
    },
    primaryType: "BorrowAuthorization",
    message: {
      offerId,
      borrower: borrower.account.address,
      expiry,
      authorizationId,
    },
  });
  await escrow.write.acceptOffer(
    [offerId, expiry, authorizationId, signature],
    {
      account: borrower.account,
    },
  );
  const loanId = (await escrow.read.nextLoanId()) - 1n;
  const loan = await escrow.read.loans([loanId]);
  return {
    chainLoanId: loanId.toString(),
    repayment: loan[6],
    dueAt: new Date(Number(loan[8]) * 1_000),
  };
}

console.log(
  "▶ Borrower takes two employee loans (52.5 USDC due in 2 days, 30 USDC due in 2.5 days)…",
);
const first = await fundLoan(50n * USDC, 500n, 2n * DAY, "loan-a");
const second = await fundLoan(30n * USDC, 0n, (5n * DAY) / 2n, "loan-b");
// Principal received is 80 USDC; top up to the scenario's 90 USDC balance.
await usdc.write.mint([borrower.account.address, 10n * USDC]);

console.log(
  "▶ Borrower grants a mandate: ≤25 USDC per repayment, ≤100 per 30 days, keep ≥40 USDC, act ≤7 days before due…",
);
await usdc.write.approve([escrow.address, 100n * USDC], {
  account: borrower.account,
});
await escrow.write.setRepaymentMandate(
  [
    agent.account.address,
    25n * USDC,
    100n * USDC,
    40n * USDC,
    30n * DAY,
    7n * DAY,
    (await now()) + 90n * DAY,
  ],
  { account: borrower.account },
);

const gateway = new ViemRepaymentGateway({
  publicClient: publicClient as never,
  walletClient: agent as never,
  contractAddress: escrow.address,
  usdcAddress: usdc.address,
});
const clock = new MutableClock(new Date(Number(await now()) * 1_000));
const realClock = { now: () => new Date() };
const borrowerRef = {
  organizationId: "00000000-0000-4000-8000-0000000000aa",
  borrowerMembershipId: "00000000-0000-4000-8000-0000000000bb",
};
const repository = new InMemoryRepaymentAgentRepository(
  {
    ...borrowerRef,
    userId: "00000000-0000-4000-8000-0000000000cc",
    email: "borrower@example.test",
    name: "Demo Borrower",
    walletAddress: borrower.account.address,
    employmentActive: true,
  },
  clock,
);
for (const [index, loan] of [first, second].entries()) {
  const loanId = `00000000-0000-4000-8000-00000000010${index}`;
  repository.obligations.set(loanId, {
    loanId,
    chainLoanId: loan.chainLoanId,
    contractAddress: escrow.address,
    lenderWalletAddress: lender.account.address,
    dueAt: loan.dueAt,
    repaymentBaseUnits: loan.repayment,
    agentEligible: true,
    status: "ACTIVE",
  });
}

const rules = new RuleBasedRepaymentPlanner();
const planner =
  process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
    ? new FallbackPlanner(
        new OpenAiRepaymentPlanner({
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL,
          baseUrl: process.env.OPENAI_BASE_URL,
        }),
        rules,
      )
    : rules;
console.log(
  `▶ Planner: ${planner.kind === "MODEL" ? `${planner.model} (rule fallback)` : "deterministic rules"}\n`,
);

const notifier = new RecordingNotifier();
let idSequence = 0;
const summary = await runRepaymentAgent(borrowerRef, "MANUAL", {
  repository,
  gateway,
  reconciliation: new StaticReconciliationHealth(),
  notifier,
  planner,
  clock: realClock,
  newId: () =>
    `00000000-0000-4000-9000-${(++idSequence).toString(16).padStart(12, "0")}`,
  hooks: {
    async afterPaymentConfirmed() {
      // The borrower independently spends 27 USDC right after the payment.
      await usdc.write.transfer([merchant.account.address, 27n * USDC], {
        account: borrower.account,
      });
    },
  },
});

const [run] = repository.runs.values();
console.log("Activity log");
console.log("────────────");
for (const step of run.steps) {
  console.log(
    `${String(step.sequence).padStart(2)} ${step.phase.padEnd(8)} ${step.name.padEnd(30)} ${step.summary}`,
  );
}
console.log(`\nRun outcome: ${summary.status} — ${summary.summary}`);

const approval = [...repository.actions.values()].find(
  (action) => action.status === "AWAITING_APPROVAL",
);
if (approval?.amountBaseUnits) {
  console.log(
    `\n▶ Borrower approves the ${show(approval.amountBaseUnits)} request with their own signature…`,
  );
  const allowance = await usdc.read.allowance([
    borrower.account.address,
    escrow.address,
  ]);
  await usdc.write.approve(
    [escrow.address, allowance + approval.amountBaseUnits],
    { account: borrower.account },
  );
  const obligation = repository.obligations.get(approval.loanId)!;
  const hash = await escrow.write.repayLoanPartial(
    [
      BigInt(obligation.chainLoanId),
      approval.amountBaseUnits,
      approval.chainRepaymentId,
    ],
    { account: borrower.account },
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const verified = verifyRepaymentLogs(receipt.logs, {
    contractAddress: escrow.address,
    usdcAddress: usdc.address,
    chainLoanId: obligation.chainLoanId,
    chainRepaymentId: approval.chainRepaymentId,
    amountBaseUnits: approval.amountBaseUnits,
    borrower: borrower.account.address,
    lender: lender.account.address,
    agent: null,
  });
  console.log(
    `  Receipt ${hash.slice(0, 18)}… verified: ${verified.verified} (${verified.checks.map((check) => check.code).join(", ")})`,
  );
}

const balance = await usdc.read.balanceOf([
  borrower.account.address as Address,
]);
console.log("\nFinal on-chain state");
console.log(`  Borrower wallet: ${show(balance)}`);
for (const [index, loan] of [first, second].entries()) {
  const repaid = await escrow.read.repaidAmounts([BigInt(loan.chainLoanId)]);
  console.log(
    `  L${index + 1}: repaid ${show(repaid)} of ${show(loan.repayment)}`,
  );
}
console.log(
  `  Notifications: ${notifier.sent.map((item) => `[${item.kind}] ${item.subject}`).join("; ") || "none"}\n`,
);
