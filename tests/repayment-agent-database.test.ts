import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/infrastructure/database/prisma";
import { DuplicateInFlightError } from "@/modules/repayment-agent/application/ports";
import {
  runRepaymentAgent,
  type RepaymentAgentDependencies,
} from "@/modules/repayment-agent/application/run-repayment-agent";
import { SimulatedEscrowChain } from "@/modules/repayment-agent/evals/simulated-chain";
import {
  MutableClock,
  RecordingNotifier,
  StaticReconciliationHealth,
  usdcUnits,
} from "@/modules/repayment-agent/evals/sim-world";
import { prismaRepaymentAgentRepository } from "@/modules/repayment-agent/infrastructure/prisma-repayment-agent-repository";
import { RuleBasedRepaymentPlanner } from "@/modules/repayment-agent/infrastructure/rule-based-planner";

const HOUR = 3_600_000;
const organizationId = randomUUID();
const borrowerUserId = randomUUID();
const lenderUserId = randomUUID();
const borrowerWallet = `0x${randomUUID().replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`;
const lenderWallet = `0x${randomUUID().replaceAll("-", "").padEnd(40, "1").slice(0, 40)}`;
let borrowerMembershipId: string;
let loanId: string;
let installmentId: string;

const clock = new MutableClock(new Date());
const chain = new SimulatedEscrowChain(clock);
const borrower = () => ({ organizationId, borrowerMembershipId });

function mandate(
  overrides: { maxPerRepayment?: number; reserve?: number } = {},
) {
  chain.setMandate(borrowerWallet, {
    agentAddress: chain.agentAddress,
    maxPerRepaymentBaseUnits: usdcUnits(overrides.maxPerRepayment ?? 25),
    maxPerPeriodBaseUnits: usdcUnits(200),
    minimumReserveBaseUnits: usdcUnits(overrides.reserve ?? 40),
    periodSeconds: 30 * 86_400,
    earliestBeforeDueSeconds: 7 * 86_400,
    expiresAt: new Date(clock.now().getTime() + 90 * 24 * HOUR),
  });
}

function deps(): RepaymentAgentDependencies {
  return {
    repository: prismaRepaymentAgentRepository,
    gateway: chain,
    reconciliation: new StaticReconciliationHealth(),
    notifier: new RecordingNotifier(),
    planner: new RuleBasedRepaymentPlanner(),
    clock,
    newId: randomUUID,
  };
}

beforeAll(async () => {
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Agent Test",
      slug: `agent-${organizationId}`,
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: borrowerUserId,
        email: `${borrowerUserId}@example.test`,
        name: "Borrower",
        passwordHash: "test",
      },
      {
        id: lenderUserId,
        email: `${lenderUserId}@example.test`,
        name: "Lender",
        passwordHash: "test",
      },
    ],
  });
  const [borrowerMembership, lenderMembership] = await Promise.all([
    prisma.organizationMembership.create({
      data: { organizationId, userId: borrowerUserId, role: "EMPLOYEE" },
    }),
    prisma.organizationMembership.create({
      data: { organizationId, userId: lenderUserId, role: "EMPLOYEE" },
    }),
  ]);
  borrowerMembershipId = borrowerMembership.id;
  await prisma.arcWallet.create({
    data: {
      userId: borrowerUserId,
      address: borrowerWallet,
      status: "ACTIVE",
      enrollmentState: "ACTIVE",
    },
  });

  const dueAt = new Date(clock.now().getTime() + 48 * HOUR);
  const activatedAt = new Date(clock.now().getTime() - HOUR);
  const loan = await prisma.loan.create({
    data: {
      organizationId,
      lenderMembershipId: lenderMembership.id,
      borrowerMembershipId,
      chainLoanId: "1",
      chainOfferId: "1",
      contractAddress: chain.contractAddress,
      lenderWalletAddress: lenderWallet,
      borrowerWalletAddress: borrowerWallet,
      principalBaseUnits: usdcUnits(50),
      repaymentBaseUnits: usdcUnits(52.5),
      principalAmountMinorUnits: 5_000n,
      feeAmountMinorUnits: 250n,
      outstandingPrincipalMinorUnits: 5_000n,
      currency: "USD",
      durationDays: 2,
      feeRateBasisPoints: 500,
      status: "ACTIVE",
      requestedAt: activatedAt,
      approvedAt: activatedAt,
      activatedAt,
      startedAt: activatedAt,
      repaymentDueAt: dueAt,
      onChainDueAt: dueAt,
    },
  });
  loanId = loan.id;
  const plan = await prisma.loanRepaymentPlan.create({
    data: {
      organizationId,
      loanId,
      version: 1,
      status: "ACTIVE",
      termMonths: 1,
      installmentCount: 1,
      totalRepaymentMinorUnits: 5_250n,
      currency: "USD",
      borrowerConsentedAt: clock.now(),
      effectiveAt: clock.now(),
    },
  });
  installmentId = (
    await prisma.loanInstallment.create({
      data: {
        organizationId,
        loanId,
        planId: plan.id,
        sequence: 1,
        amountMinorUnits: 5_250n,
        dueAt,
      },
    })
  ).id;

  chain.addLoan({
    chainLoanId: "1",
    borrower: borrowerWallet,
    lender: lenderWallet,
    repaymentAmountBaseUnits: usdcUnits(52.5),
    dueAt,
  });
  chain.setBalance(borrowerWallet, usdcUnits(90));
  chain.allowances.set(borrowerWallet.toLowerCase(), usdcUnits(200));
  mandate();
});

afterAll(async () => {
  await prisma.repaymentAgentStep.deleteMany({ where: { organizationId } });
  await prisma.repaymentAgentAction.deleteMany({ where: { organizationId } });
  await prisma.repaymentAgentRun.deleteMany({ where: { organizationId } });
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SET LOCAL app.allow_ledger_cleanup = 'on'",
    );
    await transaction.organization.deleteMany({
      where: { id: organizationId },
    });
  });
  await prisma.user.deleteMany({
    where: { id: { in: [borrowerUserId, lenderUserId] } },
  });
  await prisma.$disconnect();
});

describe("repayment agent with the PostgreSQL repository", () => {
  it("pays a verified partial repayment and settles every application record", async () => {
    const summary = await runRepaymentAgent(borrower(), "MANUAL", deps());

    expect(summary.decisions.map((item) => item.action)).toEqual([
      "PAY_PARTIAL",
      "WAIT",
    ]);
    expect(summary.status).toBe("WAITING");

    const repayment = await prisma.loanRepayment.findFirstOrThrow({
      where: { loanId, status: "COMPLETED" },
      include: { allocations: true },
    });
    expect(repayment.amountMinorUnits).toBe(2_500n);
    expect(repayment.submissionTransactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(repayment.allocations).toMatchObject([
      { installmentId, amountMinorUnits: 2_500n },
    ]);
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    // The 2.50 fee is settled first, so principal falls by 22.50.
    expect(loan.outstandingPrincipalMinorUnits).toBe(2_750n);
    expect(loan.status).toBe("ACTIVE");

    const action = await prisma.repaymentAgentAction.findFirstOrThrow({
      where: { loanId, status: "CONFIRMED" },
    });
    expect(action.amountBaseUnits).toBe(usdcUnits(25));
    const run = await prisma.repaymentAgentRun.findUniqueOrThrow({
      where: { id: summary.runId },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    expect(run.status).toBe("WAITING");
    expect(run.steps.map((step) => step.name)).toEqual(
      expect.arrayContaining([
        "POLICY_CHECKS",
        "PRE_EXECUTION_RECHECK",
        "submitAuthorizedRepayment",
        "verifyRepaymentReceipt",
        "LEDGER_UPDATED",
      ]),
    );
    expect(
      await prisma.auditEvent.count({
        where: { loanId, type: "REPAYMENT_COMPLETED" },
      }),
    ).toBe(1);
  });

  it("holds a run lease per borrower and expires stale leases", async () => {
    const lease = await prisma.repaymentAgentRun.create({
      data: {
        organizationId,
        borrowerMembershipId,
        trigger: "SCHEDULED",
        plannerKind: "RULES",
        promptVersion: "test",
        policyVersion: "test",
        inputSnapshot: {},
        startedAt: clock.now(),
      },
    });
    const blocked = await runRepaymentAgent(borrower(), "MANUAL", deps());
    expect(blocked.outcomeCode).toBe("RUN_ALREADY_ACTIVE");

    await prisma.repaymentAgentRun.update({
      where: { id: lease.id },
      data: { startedAt: new Date(clock.now().getTime() - HOUR) },
    });
    const resumed = await runRepaymentAgent(borrower(), "MANUAL", deps());
    expect(resumed.outcomeCode).not.toBe("RUN_ALREADY_ACTIVE");
    expect(
      (
        await prisma.repaymentAgentRun.findUniqueOrThrow({
          where: { id: lease.id },
        })
      ).outcomeCode,
    ).toBe("RUN_LEASE_EXPIRED");
  });

  it("refuses a second in-flight repayment at the database", async () => {
    const run = await prismaRepaymentAgentRepository.startRun({
      borrower: borrower(),
      trigger: "MANUAL",
      plannerKind: "RULES",
      plannerModel: null,
      promptVersion: "test",
      policyVersion: "test",
      startedAt: clock.now(),
      parentRunId: null,
    });
    const create = () =>
      prismaRepaymentAgentRepository.createAction({
        runId: run.id,
        repaymentRequestId: randomUUID(),
        borrower: borrower(),
        loanId,
        action: "PAY_PARTIAL",
        amountBaseUnits: usdcUnits(1),
        status: "VALIDATED",
        mandateNonce: 1n,
        decision: {},
        validation: [],
        expiresAt: null,
      });
    const first = await create();
    // One open repayment intent per loan: a second plan is blocked, not crashed.
    await expect(create()).rejects.toBeInstanceOf(DuplicateInFlightError);
    await prismaRepaymentAgentRepository.markSubmitted(
      first.id,
      `0x${"a".repeat(64)}`,
      clock.now(),
    );
    expect(
      (await prismaRepaymentAgentRepository.findInFlight(borrower()))?.actionId,
    ).toBe(first.id);
    await prismaRepaymentAgentRepository.finishRun(run.id, {
      status: "WAITING",
      outcomeCode: "TEST",
      outcomeSummary: "test",
      decision: null,
      requiresHumanApproval: false,
      completedAt: clock.now(),
      plannerKind: "RULES",
      plannerModel: null,
    });
    // A monitored in-flight payment stops the agent from planning another.
    const monitored = await runRepaymentAgent(borrower(), "MANUAL", deps());
    expect(monitored.outcomeCode).toBe("IN_FLIGHT_PENDING");
    expect(chain.submissions).toBe(1);

    await prismaRepaymentAgentRepository.markFailed(
      first.id,
      "TEST_CLEANUP",
      {},
    );
    expect(
      await prisma.loanRepayment.count({ where: { loanId, status: "FAILED" } }),
    ).toBe(1);
  });

  it("closes the loan with exact cents when a replaced mandate allows the remainder", async () => {
    clock.advance(21 * HOUR);
    mandate({ maxPerRepayment: 60, reserve: 0 });

    const summary = await runRepaymentAgent(borrower(), "MANUAL", deps());

    expect(summary.decisions[0]?.action).toBe("PAY_FULL");
    const loan = await prisma.loan.findUniqueOrThrow({
      where: { id: loanId },
      include: { repayments: { where: { status: "COMPLETED" } } },
    });
    expect(loan.status).toBe("REPAID");
    expect(loan.outstandingPrincipalMinorUnits).toBe(0n);
    expect(loan.repayments.map((item) => item.amountMinorUnits).sort()).toEqual(
      [2_500n, 2_750n],
    );
    expect(loan.repaymentTransactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(
      await prisma.auditEvent.count({ where: { loanId, type: "LOAN_REPAID" } }),
    ).toBe(1);
  });
});
