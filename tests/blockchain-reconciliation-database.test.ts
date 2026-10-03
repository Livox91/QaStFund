import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/infrastructure/database/prisma";
import { fundingRequestIdToBytes32 } from "@/integrations/arc/employee-lending-escrow";
import type { StoredReconciliationEvent } from "@/modules/blockchain-reconciliation/domain/blockchain-event";
import { prismaReconciliationRepository } from "@/modules/blockchain-reconciliation/infrastructure/prisma-reconciliation-repository";

const organizationA = randomUUID();
const organizationB = randomUUID();
const lenderUserId = randomUUID();
const borrowerUserId = randomUUID();
const otherUserId = randomUUID();
const lenderMembershipId = randomUUID();
const borrowerMembershipId = randomUUID();
const otherMembershipId = randomUUID();
const contractAddress = `0x${randomBytes(20).toString("hex")}`;
const lenderAddress = "0x2222222222222222222222222222222222222222";
const borrowerAddress = "0x3333333333333333333333333333333333333333";
const otherAddress = "0x4444444444444444444444444444444444444444";
const now = new Date("2026-10-03T12:00:00.000Z");
const startTime = 1_791_028_800n;
const dueTime = startTime + 30n * 86_400n;
const repaidAt = startTime + 3_600n;

async function journal(event: StoredReconciliationEvent) {
  await prisma.blockchainEvent.create({
    data: {
      id: event.id,
      chainId: 5_042_002,
      contractAddress,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      name: event.name,
      status: "PROVISIONAL",
      isFinalized: true,
      finalizedAt: now,
      payload: { ...event.payload, blockTimestamp: now.toISOString() },
    },
  });
}

describe("Prisma blockchain reconciliation", () => {
  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        {
          id: organizationA,
          name: "Reconciliation A",
          slug: `ra-${organizationA}`,
        },
        {
          id: organizationB,
          name: "Reconciliation B",
          slug: `rb-${organizationB}`,
        },
      ],
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
          id: otherUserId,
          email: `${otherUserId}@test.local`,
          name: "Other tenant",
          passwordHash: "test-only",
        },
      ],
    });
    await prisma.organizationMembership.createMany({
      data: [
        {
          id: lenderMembershipId,
          organizationId: organizationA,
          userId: lenderUserId,
          role: "EMPLOYEE",
        },
        {
          id: borrowerMembershipId,
          organizationId: organizationA,
          userId: borrowerUserId,
          role: "EMPLOYEE",
        },
        {
          id: otherMembershipId,
          organizationId: organizationB,
          userId: otherUserId,
          role: "EMPLOYEE",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.blockchainEvent.deleteMany({ where: { contractAddress } });
    await prisma.blockchainReconciliationCursor.deleteMany({
      where: { contractAddress },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationA, organizationB] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [lenderUserId, borrowerUserId, otherUserId] } },
    });
  });

  it("recovers missed funding, acceptance, and repayment callbacks without cross-tenant writes", async () => {
    const fundingRequestId = randomUUID();
    const offerId = randomUUID();
    const otherOfferId = randomUUID();
    await prisma.lendingOffer.createMany({
      data: [
        {
          id: offerId,
          organizationId: organizationA,
          lenderMembershipId,
          amountMinorUnits: 10_000n,
          availableAmountMinorUnits: 10_000n,
          minimumLoanAmountMinorUnits: 10_000n,
          maximumLoanAmountMinorUnits: 10_000n,
          currency: "USD",
          durationDays: 30,
          feeRateBasisPoints: 500,
          expiresAt: new Date("2026-11-03T12:00:00.000Z"),
          status: "PAUSED",
          fundingStatus: "PENDING",
          fundingRequestId,
          lenderWalletAddress: lenderAddress,
          principalBaseUnits: 100_000_000n,
          contractAddress,
        },
        {
          id: otherOfferId,
          organizationId: organizationB,
          lenderMembershipId: otherMembershipId,
          amountMinorUnits: 10_000n,
          availableAmountMinorUnits: 10_000n,
          minimumLoanAmountMinorUnits: 10_000n,
          maximumLoanAmountMinorUnits: 10_000n,
          currency: "USD",
          durationDays: 30,
          feeRateBasisPoints: 500,
          expiresAt: new Date("2026-11-03T12:00:00.000Z"),
          status: "PAUSED",
          fundingStatus: "PENDING",
          fundingRequestId: randomUUID(),
          lenderWalletAddress: otherAddress,
          principalBaseUnits: 100_000_000n,
          contractAddress,
        },
      ],
    });

    const fundingEvent: StoredReconciliationEvent = {
      id: randomUUID(),
      name: "OFFER_CREATED",
      blockNumber: 100n,
      blockHash: `0x${"a".repeat(64)}`,
      blockTimestamp: now,
      transactionHash: `0x${"1".repeat(64)}`,
      logIndex: 0,
      payload: {
        offerId: "41",
        lender: lenderAddress,
        principal: "100000000",
        interestBps: "500",
        duration: (30n * 86_400n).toString(),
        requestId: fundingRequestIdToBytes32(fundingRequestId).toLowerCase(),
      },
    };
    await journal(fundingEvent);
    await expect(
      prismaReconciliationRepository.applyEvent(fundingEvent, now),
    ).resolves.toMatchObject({
      kind: "APPLIED",
      organizationId: organizationA,
      recordId: offerId,
    });
    await expect(
      prisma.lendingOffer.findUniqueOrThrow({ where: { id: offerId } }),
    ).resolves.toMatchObject({
      fundingStatus: "FUNDED",
      status: "ACTIVE",
      chainOfferId: "41",
    });
    await expect(
      prisma.lendingOffer.findUniqueOrThrow({ where: { id: otherOfferId } }),
    ).resolves.toMatchObject({ fundingStatus: "PENDING", status: "PAUSED" });

    const loanId = randomUUID();
    await prisma.loan.create({
      data: {
        id: loanId,
        organizationId: organizationA,
        lenderMembershipId,
        borrowerMembershipId,
        lendingOfferId: offerId,
        borrowRequestId: randomUUID(),
        chainOfferId: "41",
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
        status: "REQUESTED",
        requestedAt: now,
        startedAt: now,
        repaymentDueAt: new Date(Number(dueTime) * 1_000),
      },
    });
    const acceptanceEvent: StoredReconciliationEvent = {
      id: randomUUID(),
      name: "LOAN_STARTED",
      blockNumber: 101n,
      blockHash: `0x${"b".repeat(64)}`,
      blockTimestamp: now,
      transactionHash: `0x${"2".repeat(64)}`,
      logIndex: 1,
      payload: {
        loanId: "73",
        offerId: "41",
        lender: lenderAddress,
        borrower: borrowerAddress,
        principal: "100000000",
        repaymentAmount: "105000000",
        startTime: startTime.toString(),
        dueTime: dueTime.toString(),
      },
    };
    await journal(acceptanceEvent);
    await expect(
      prismaReconciliationRepository.applyEvent(acceptanceEvent, now),
    ).resolves.toMatchObject({ kind: "APPLIED", recordId: loanId });
    await expect(
      prisma.loan.findUniqueOrThrow({ where: { id: loanId } }),
    ).resolves.toMatchObject({ status: "ACTIVE", chainLoanId: "73" });

    const repaymentId = randomUUID();
    await prisma.loanRepayment.create({
      data: {
        id: repaymentId,
        organizationId: organizationA,
        loanId,
        repaymentRequestId: randomUUID(),
        amountMinorUnits: 10_500n,
        currency: "USD",
        status: "PENDING",
        paidAt: now,
      },
    });
    const repaymentEvent: StoredReconciliationEvent = {
      id: randomUUID(),
      name: "LOAN_REPAID",
      blockNumber: 102n,
      blockHash: `0x${"c".repeat(64)}`,
      blockTimestamp: now,
      transactionHash: `0x${"3".repeat(64)}`,
      logIndex: 2,
      payload: {
        loanId: "73",
        borrower: borrowerAddress,
        lender: lenderAddress,
        amount: "105000000",
        repaidAt: repaidAt.toString(),
      },
    };
    await journal(repaymentEvent);
    await expect(
      prismaReconciliationRepository.applyEvent(repaymentEvent, now),
    ).resolves.toMatchObject({ kind: "APPLIED", recordId: repaymentId });
    await expect(
      prismaReconciliationRepository.applyEvent(repaymentEvent, now),
    ).resolves.toEqual({ kind: "ALREADY_APPLIED" });

    await expect(
      prisma.loan.findUniqueOrThrow({ where: { id: loanId } }),
    ).resolves.toMatchObject({
      status: "REPAID",
      outstandingPrincipalMinorUnits: 0n,
    });
    await expect(
      prisma.loanRepayment.findUniqueOrThrow({ where: { id: repaymentId } }),
    ).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(
      prisma.loanRepayment.count({ where: { loanId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditEvent.count({
        where: {
          organizationId: organizationA,
          loanId,
          type: {
            in: ["LOAN_ACTIVATED", "REPAYMENT_COMPLETED", "LOAN_REPAID"],
          },
        },
      }),
    ).resolves.toBe(3);
    await expect(
      prisma.auditEvent.count({ where: { organizationId: organizationB } }),
    ).resolves.toBe(0);
  });
});
