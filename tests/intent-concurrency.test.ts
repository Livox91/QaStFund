import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/infrastructure/database/prisma";
import { prepareOnChainBorrow } from "@/modules/loans/application/onchain-borrow";
import { prepareOnChainRepayment } from "@/modules/loans/application/onchain-repayment";

const organizationId = randomUUID();
const lenderUserId = randomUUID();
const borrowerUserId = randomUUID();
const lenderMembershipId = randomUUID();
const borrowerMembershipId = randomUUID();
const contractAddress = "0x1111111111111111111111111111111111111111";
const lenderAddress = "0x2222222222222222222222222222222222222222";
const borrowerAddress = "0x3333333333333333333333333333333333333333";
const signerAddress = "0x4444444444444444444444444444444444444444";
const now = new Date("2026-10-03T12:00:00.000Z");
let nextChainOfferId = 1n;
let nextChainLoanId = 1n;

const actor = { organizationId, userId: borrowerUserId } as const;

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
      ],
    });
    await prisma.arcWallet.create({
      data: {
        organizationId,
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
      where: { id: { in: [lenderUserId, borrowerUserId] } },
    });
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
