import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/infrastructure/database/prisma";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { overrideOriginationDecisionForActor } from "@/modules/loan-decisions/application/origination-decisions";
import { prepareOnChainBorrow } from "@/modules/loans/application/onchain-borrow";
import { prepareOnChainRepayment } from "@/modules/loans/application/onchain-repayment";

const organizationId = randomUUID();
const lenderUserId = randomUUID();
const borrowerUserId = randomUUID();
const adminUserId = randomUUID();
const lenderMembershipId = randomUUID();
const borrowerMembershipId = randomUUID();
const adminMembershipId = randomUUID();
const contractAddress = "0x1111111111111111111111111111111111111111";
const lenderAddress = "0x2222222222222222222222222222222222222222";
const borrowerAddress = "0x3333333333333333333333333333333333333333";
const signerAddress = "0x4444444444444444444444444444444444444444";
const now = new Date("2026-10-03T12:00:00.000Z");
let nextChainOfferId = 1n;
let nextChainLoanId = 1n;

const actor = { organizationId, userId: borrowerUserId } as const;
const admin = {
  organizationId,
  organizationName: "Intent Concurrency Test",
  organizationSlug: `intent-${organizationId}`,
  userId: adminUserId,
  email: `${adminUserId}@test.local`,
  name: "Reviewer",
  role: ApplicationRole.EMPLOYER_ADMIN,
} as const;

async function createOffer() {
  const id = randomUUID();
  const chainOfferId = nextChainOfferId++;
  await prisma.lendingOffer.create({
    data: {
      id,
      organizationId,
      lenderMembershipId,
      amountMinorUnits: 10_000n,
      availableAmountMinorUnits: 10_000n,
      minimumLoanAmountMinorUnits: 10_000n,
      maximumLoanAmountMinorUnits: 10_000n,
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 500,
      expiresAt: new Date("2026-11-03T12:00:00.000Z"),
      status: "ACTIVE",
      fundingStatus: "FUNDED",
      lenderWalletAddress: lenderAddress,
      principalBaseUnits: 100_000_000n,
      chainOfferId: chainOfferId.toString(),
      contractAddress,
    },
  });
  return { id, chainOfferId };
}

function borrowDependencies(chainOfferId: bigint) {
  return {
    contractAddress,
    database: prisma,
    now: () => now,
    readOffer: vi
      .fn()
      .mockResolvedValue([
        chainOfferId,
        lenderAddress,
        100_000_000n,
        500n,
        30n * 86_400n,
        true,
        `0x${"0".repeat(64)}`,
      ]),
    readAuthorizationSigner: vi.fn().mockResolvedValue(signerAddress),
    signAuthorization: vi.fn(async (authorization) => ({
      ...authorization,
      signerAddress,
      signature: `0x${"a".repeat(130)}`,
    })),
    evaluateOrigination: vi.fn().mockResolvedValue({
      status: "APPROVAL_CONSIDERATION",
      override: { outcome: "APPROVED" },
    }),
  } as never;
}

async function createRepayableLoan() {
  const id = randomUUID();
  const chainLoanId = nextChainLoanId++;
  const chainOfferId = nextChainOfferId++;
  await prisma.loan.create({
    data: {
      id,
      organizationId,
      lenderMembershipId,
      borrowerMembershipId,
      chainLoanId: chainLoanId.toString(),
      chainOfferId: chainOfferId.toString(),
      contractAddress,
      lenderWalletAddress: lenderAddress,
      borrowerWalletAddress: borrowerAddress,
      principalBaseUnits: 100_000_000n,
      repaymentBaseUnits: 105_000_000n,
      principalAmountMinorUnits: 10_000n,
      feeAmountMinorUnits: 500n,
      outstandingPrincipalMinorUnits: 10_000n,
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 500,
      status: "ACTIVE",
      requestedAt: now,
      approvedAt: now,
      activatedAt: now,
      startedAt: now,
      repaymentDueAt: new Date("2026-11-03T12:00:00.000Z"),
    },
  });
  return { id, chainLoanId, chainOfferId };
}

function repaymentDependencies(input: {
  chainLoanId: bigint;
  chainOfferId: bigint;
}) {
  return {
    contractAddress,
    database: prisma,
    now: () => now,
    readLoan: vi
      .fn()
      .mockResolvedValue([
        input.chainLoanId,
        input.chainOfferId,
        lenderAddress,
        borrowerAddress,
        100_000_000n,
        500n,
        105_000_000n,
        0n,
        0n,
        0,
        0n,
      ]),
    readBalance: vi.fn().mockResolvedValue(200_000_000n),
  } as never;
}

describe("on-chain intent concurrency", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Intent Concurrency Test",
        slug: `intent-${organizationId}`,
      },
    });
    await prisma.user.createMany({
      data: [
        {
          id: lenderUserId,
          email: `${lenderUserId}@test.local`,
          name: "Lender",
          passwordHash: "test-only",
        },
        {
          id: borrowerUserId,
          email: `${borrowerUserId}@test.local`,
          name: "Borrower",
          passwordHash: "test-only",
        },
        {
          id: adminUserId,
          email: `${adminUserId}@test.local`,
          name: "Reviewer",
          passwordHash: "test-only",
        },
      ],
    });
    await prisma.organizationMembership.createMany({
      data: [
        {
          id: lenderMembershipId,
          organizationId,
          userId: lenderUserId,
          role: "EMPLOYEE",
        },
        {
          id: borrowerMembershipId,
          organizationId,
          userId: borrowerUserId,
          role: "EMPLOYEE",
        },
        {
          id: adminMembershipId,
          organizationId,
          userId: adminUserId,
          role: "EMPLOYER_ADMIN",
        },
      ],
    });
    await prisma.arcWallet.create({
      data: {
        userId: borrowerUserId,
        address: borrowerAddress,
        status: "ACTIVE",
        enrollmentState: "ACTIVE",
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [lenderUserId, borrowerUserId, adminUserId] } },
    });
  });

  afterEach(async () => {
    await prisma.loan.updateMany({
      where: { organizationId, status: { in: ["REQUESTED", "APPROVED"] } },
      data: { status: "CANCELLED", closedAt: now },
    });
  });

  it("persists review-required and withholds authorization when evidence is unavailable", async () => {
    const offer = await createOffer();
    const injected = borrowDependencies(offer.chainOfferId) as Record<
      string,
      unknown
    >;
    const signAuthorization = injected.signAuthorization as ReturnType<
      typeof vi.fn
    >;
    const { evaluateOrigination: _ignored, ...dependencies } = injected;
    void _ignored;

    await expect(
      prepareOnChainBorrow(
        actor as never,
        offer.id,
        randomUUID(),
        dependencies as never,
      ),
    ).resolves.toMatchObject({ state: "REVIEW_REQUIRED" });
    expect(signAuthorization).not.toHaveBeenCalled();
    await expect(
      prisma.loanOriginationDecision.count({
        where: { loan: { lendingOfferId: offer.id } },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditEvent.count({
        where: {
          lendingOfferId: offer.id,
          type: "LOAN_REQUESTED",
        },
      }),
    ).resolves.toBe(1);
  });

  it("requires an audited review before issuing an Arc authorization", async () => {
    const offer = await createOffer();
    const requestId = randomUUID();
    const injected = borrowDependencies(offer.chainOfferId) as Record<
      string,
      unknown
    >;
    const signAuthorization = injected.signAuthorization as ReturnType<
      typeof vi.fn
    >;
    const { evaluateOrigination: _ignored, ...dependencies } = injected;
    void _ignored;

    const application = await prepareOnChainBorrow(
      actor as never,
      offer.id,
      requestId,
      dependencies as never,
    );
    expect(application).toMatchObject({ state: "REVIEW_REQUIRED" });
    expect(signAuthorization).not.toHaveBeenCalled();
    if (application.state !== "REVIEW_REQUIRED") {
      throw new Error("Expected an application awaiting review.");
    }

    await overrideOriginationDecisionForActor(
      admin,
      {
        decisionId: application.decisionId,
        outcome: "APPROVED",
        rationale:
          "The employer reviewer verified supporting affordability evidence.",
      },
      new Date("2026-10-03T12:01:00.000Z"),
    );
    await expect(
      prisma.loan.findUniqueOrThrow({ where: { id: application.loanId } }),
    ).resolves.toMatchObject({
      status: "APPROVED",
      activatedAt: null,
      acceptanceTransactionHash: null,
    });

    const authorized = await prepareOnChainBorrow(
      actor as never,
      offer.id,
      requestId,
      dependencies as never,
    );
    expect(authorized).toMatchObject({
      state: "PENDING",
      loanId: application.loanId,
    });
    expect(signAuthorization).toHaveBeenCalledTimes(1);
    await expect(
      prisma.auditEvent.count({
        where: {
          loanId: application.loanId,
          type: { in: ["LOAN_REQUESTED", "LOAN_APPROVED"] },
        },
      }),
    ).resolves.toBe(2);

    await prisma.loan.update({
      where: { id: application.loanId },
      data: {
        status: "CANCELLED",
        closedAt: new Date("2026-10-03T12:02:00.000Z"),
      },
    });
    await expect(
      prepareOnChainBorrow(
        actor as never,
        offer.id,
        requestId,
        dependencies as never,
      ),
    ).resolves.toMatchObject({ state: "PENDING", loanId: application.loanId });
    await expect(
      prisma.loan.findUniqueOrThrow({ where: { id: application.loanId } }),
    ).resolves.toMatchObject({
      status: "APPROVED",
      requestedAt: now,
      approvedAt: new Date("2026-10-03T12:01:00.000Z"),
      closedAt: null,
    });
    expect(signAuthorization).toHaveBeenCalledTimes(2);
  });

  it("returns one acceptance intent for concurrent requests with the same key", async () => {
    const offer = await createOffer();
    const requestId = randomUUID();
    const dependencies = borrowDependencies(offer.chainOfferId);

    const [first, second] = await Promise.all([
      prepareOnChainBorrow(actor as never, offer.id, requestId, dependencies),
      prepareOnChainBorrow(actor as never, offer.id, requestId, dependencies),
    ]);

    expect(first.state).toBe("PENDING");
    expect(second.state).toBe("PENDING");
    expect(first.loanId).toBe(second.loanId);
    await expect(
      prisma.loan.count({ where: { lendingOfferId: offer.id } }),
    ).resolves.toBe(1);
  });

  it("allows only one unresolved application across concurrent offers", async () => {
    const [firstOffer, secondOffer] = await Promise.all([
      createOffer(),
      createOffer(),
    ]);
    const results = await Promise.allSettled([
      prepareOnChainBorrow(
        actor as never,
        firstOffer.id,
        randomUUID(),
        borrowDependencies(firstOffer.chainOfferId),
      ),
      prepareOnChainBorrow(
        actor as never,
        secondOffer.id,
        randomUUID(),
        borrowDependencies(secondOffer.chainOfferId),
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: { code: "ACCEPTANCE_INTENT_CONFLICT" },
    });
  });

  it("rejects competing acceptance keys and safely revives a cancelled intent", async () => {
    const offer = await createOffer();
    const dependencies = borrowDependencies(offer.chainOfferId);
    const requestIds = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled([
      prepareOnChainBorrow(
        actor as never,
        offer.id,
        requestIds[0],
        dependencies,
      ),
      prepareOnChainBorrow(
        actor as never,
        offer.id,
        requestIds[1],
        dependencies,
      ),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: { code: "ACCEPTANCE_INTENT_CONFLICT" },
    });

    await prisma.loan.updateMany({
      where: { lendingOfferId: offer.id, status: "REQUESTED" },
      data: { status: "CANCELLED", closedAt: now },
    });
    const winningIndex = results.findIndex(
      ({ status }) => status === "fulfilled",
    );
    const [firstRetry, secondRetry] = await Promise.all([
      prepareOnChainBorrow(
        actor as never,
        offer.id,
        requestIds[winningIndex],
        dependencies,
      ),
      prepareOnChainBorrow(
        actor as never,
        offer.id,
        requestIds[winningIndex],
        dependencies,
      ),
    ]);
    expect(firstRetry).toMatchObject({ state: "PENDING" });
    expect(secondRetry.loanId).toBe(firstRetry.loanId);
  });

  it("returns the original confirmed acceptance and rejects cross-organization key reuse", async () => {
    const offer = await createOffer();
    const requestId = randomUUID();
    const dependencies = borrowDependencies(offer.chainOfferId);
    const pending = await prepareOnChainBorrow(
      actor as never,
      offer.id,
      requestId,
      dependencies,
    );
    await prisma.loan.update({
      where: { id: pending.loanId },
      data: {
        status: "ACTIVE",
        chainLoanId: (nextChainLoanId++).toString(),
        approvedAt: now,
        activatedAt: now,
      },
    });

    await expect(
      prepareOnChainBorrow(actor as never, offer.id, requestId, dependencies),
    ).resolves.toEqual({ state: "CONFIRMED", loanId: pending.loanId });
    await expect(
      prepareOnChainBorrow(
        { userId: randomUUID(), organizationId: randomUUID() } as never,
        offer.id,
        requestId,
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "BORROW_REQUEST_CONFLICT" });
  });

  it("returns one repayment intent for concurrent requests with the same key", async () => {
    const loan = await createRepayableLoan();
    const requestId = randomUUID();
    const dependencies = repaymentDependencies(loan);

    const [first, second] = await Promise.all([
      prepareOnChainRepayment(actor as never, loan.id, requestId, dependencies),
      prepareOnChainRepayment(actor as never, loan.id, requestId, dependencies),
    ]);

    expect(first.state).toBe("PENDING");
    expect(second.state).toBe("PENDING");
    expect(first.repaymentId).toBe(second.repaymentId);
    await expect(
      prisma.loanRepayment.count({ where: { loanId: loan.id } }),
    ).resolves.toBe(1);
  });

  it("rejects competing repayment keys and safely revives a failed intent", async () => {
    const loan = await createRepayableLoan();
    const dependencies = repaymentDependencies(loan);
    const requestIds = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled([
      prepareOnChainRepayment(
        actor as never,
        loan.id,
        requestIds[0],
        dependencies,
      ),
      prepareOnChainRepayment(
        actor as never,
        loan.id,
        requestIds[1],
        dependencies,
      ),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "REPAYMENT_INTENT_CONFLICT" },
    });

    await prisma.loanRepayment.updateMany({
      where: { loanId: loan.id, status: "PENDING" },
      data: { status: "FAILED" },
    });
    const winningIndex = results.findIndex(
      ({ status }) => status === "fulfilled",
    );
    const [firstRetry, secondRetry] = await Promise.all([
      prepareOnChainRepayment(
        actor as never,
        loan.id,
        requestIds[winningIndex],
        dependencies,
      ),
      prepareOnChainRepayment(
        actor as never,
        loan.id,
        requestIds[winningIndex],
        dependencies,
      ),
    ]);
    expect(firstRetry).toMatchObject({ state: "PENDING" });
    expect(secondRetry.repaymentId).toBe(firstRetry.repaymentId);
  });

  it("keeps an unknown repayment pending and returns a confirmed retry", async () => {
    const loan = await createRepayableLoan();
    const requestId = randomUUID();
    const dependencies = repaymentDependencies(loan);
    const pending = await prepareOnChainRepayment(
      actor as never,
      loan.id,
      requestId,
      dependencies,
    );

    await expect(
      prepareOnChainRepayment(
        actor as never,
        loan.id,
        randomUUID(),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "REPAYMENT_INTENT_CONFLICT" });

    await prisma.$transaction([
      prisma.loan.update({
        where: { id: loan.id },
        data: {
          status: "REPAID",
          outstandingPrincipalMinorUnits: 0n,
          closedAt: now,
        },
      }),
      prisma.loanRepayment.update({
        where: { id: pending.repaymentId },
        data: { status: "COMPLETED", completedAt: now },
      }),
    ]);
    await expect(
      prepareOnChainRepayment(actor as never, loan.id, requestId, dependencies),
    ).resolves.toEqual({
      state: "CONFIRMED",
      repaymentId: pending.repaymentId,
      loanId: loan.id,
    });
  });
});
