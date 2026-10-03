import "dotenv/config";

import { randomUUID } from "node:crypto";

import { prisma } from "../src/infrastructure/database/prisma";
import { prismaBorrowLoanRepository } from "../src/modules/loans/infrastructure/prisma-borrow-loan-repository";
import { fundEmployeeWallet } from "../src/modules/ledger/infrastructure/prisma-wallet-repository";

const suffix = randomUUID();
let organizationId: string | undefined;
const userIds: string[] = [];

try {
  const organization = await prisma.organization.create({
    data: {
      name: "Borrow concurrency verification",
      slug: `borrow-concurrency-${suffix}`,
      currency: "USD",
    },
  });
  organizationId = organization.id;
  const testOrganizationId = organization.id;

  const users = await Promise.all(
    ["Lender", "Bob", "Charlie"].map((name) =>
      prisma.user.create({
        data: {
          email: `${name.toLowerCase()}-${suffix}@test.local`,
          name,
          passwordHash: "unused",
        },
      }),
    ),
  );
  userIds.push(...users.map(({ id }) => id));
  const [lender, bob, charlie] = users;
  if (!lender || !bob || !charlie) throw new Error("Test users missing.");

  const [lenderMembership] = await Promise.all(
    users.map((user) =>
      prisma.organizationMembership.create({
        data: {
          organizationId: testOrganizationId,
          userId: user.id,
          role: "EMPLOYEE",
        },
      }),
    ),
  );
  if (!lenderMembership) throw new Error("Lender membership missing.");
  await fundEmployeeWallet({
    organizationId: testOrganizationId,
    userId: lender.id,
    amountMinorUnits: 5_000n,
    requestId: randomUUID(),
    now: new Date(),
  });

  const offer = await prisma.lendingOffer.create({
    data: {
      organizationId: testOrganizationId,
      lenderMembershipId: lenderMembership.id,
      amountMinorUnits: 5_000n,
      availableAmountMinorUnits: 5_000n,
      minimumLoanAmountMinorUnits: 1n,
      maximumLoanAmountMinorUnits: 5_000n,
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 300,
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "ACTIVE",
    },
  });
  const now = new Date();
  const attempts = [bob, charlie].map((user) => ({
    userId: user.id,
    command: {
      offerId: offer.id,
      amountMinorUnits: 5_000n,
      requestId: randomUUID(),
    },
  }));
  const request = (attempt: (typeof attempts)[number]) =>
    prismaBorrowLoanRepository.createFromOffer({
      organizationId: testOrganizationId,
      userId: attempt.userId,
      command: attempt.command,
      now,
    });

  const results = await Promise.all(attempts.map(request));
  const successfulIndex = results.findIndex(({ kind }) => kind === "CREATED");
  const successfulAttempt = attempts[successfulIndex];
  if (!successfulAttempt) throw new Error("Successful attempt missing.");
  const retry = await request(successfulAttempt);
  const updatedOffer = await prisma.lendingOffer.findUniqueOrThrow({
    where: { id: offer.id },
  });
  const loans = await prisma.loan.findMany({
    where: { organizationId: testOrganizationId, lendingOfferId: offer.id },
  });
  const auditEvent = await prisma.auditEvent.findFirst({
    where: { organizationId: testOrganizationId, lendingOfferId: offer.id },
  });
  const createdCount = results.filter(({ kind }) => kind === "CREATED").length;
  const rejectedCount = results.filter(
    ({ kind }) =>
      kind === "INSUFFICIENT_LIQUIDITY" ||
      kind === "INSUFFICIENT_LENDER_BALANCE",
  ).length;

  if (
    createdCount !== 1 ||
    rejectedCount !== 1 ||
    loans.length !== 1 ||
    updatedOffer.availableAmountMinorUnits !== 0n ||
    updatedOffer.status !== "EXHAUSTED" ||
    updatedOffer.availableAmountMinorUnits < 0n ||
    retry.kind !== "ALREADY_CREATED" ||
    loans[0]?.principalAmountMinorUnits !== 5_000n ||
    loans[0]?.feeAmountMinorUnits !== 150n ||
    loans[0]?.durationDays !== 30 ||
    loans[0]?.feeRateBasisPoints !== 300 ||
    loans[0]?.activatedAt?.getTime() !== now.getTime() ||
    loans[0]?.repaymentDueAt.getTime() !== now.getTime() + 30 * 86_400_000 ||
    auditEvent?.loanId !== loans[0]?.id ||
    auditEvent?.amountMinorUnits !== 5_000n ||
    auditEvent?.currency !== "USD" ||
    !auditEvent.actorMembershipId
  ) {
    throw new Error(
      `Concurrent capital reservation verification failed: ${JSON.stringify({
        resultKinds: results.map(({ kind }) => kind),
        loanCount: loans.length,
        availableAmountMinorUnits:
          updatedOffer.availableAmountMinorUnits.toString(),
        offerStatus: updatedOffer.status,
        retryKind: retry.kind,
        auditEventPresent: Boolean(auditEvent),
      })}`,
    );
  }

  const rollbackOffer = await prisma.lendingOffer.create({
    data: {
      organizationId: testOrganizationId,
      lenderMembershipId: lenderMembership.id,
      amountMinorUnits: 2_500n,
      availableAmountMinorUnits: 2_500n,
      minimumLoanAmountMinorUnits: 1n,
      maximumLoanAmountMinorUnits: 2_500n,
      currency: "USD",
      durationDays: 14,
      feeRateBasisPoints: 200,
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "ACTIVE",
    },
  });
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.lendingOffer.updateMany({
        where: {
          id: rollbackOffer.id,
          organizationId: testOrganizationId,
          status: "ACTIVE",
          availableAmountMinorUnits: { gte: 2_500n },
        },
        data: { availableAmountMinorUnits: { decrement: 2_500n } },
      });
      throw new Error("Simulated downstream loan creation failure.");
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Simulated downstream loan creation failure."
    ) {
      throw error;
    }
  }
  const rolledBackOffer = await prisma.lendingOffer.findUniqueOrThrow({
    where: { id: rollbackOffer.id },
  });
  if (rolledBackOffer.availableAmountMinorUnits !== 2_500n) {
    throw new Error("Failed loan creation did not roll back reservation.");
  }

  console.log("Concurrent borrowing and failed-creation rollback verified.");
} finally {
  if (organizationId) {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('app.allow_ledger_cleanup', 'on', true)`;
      await transaction.auditEvent.deleteMany({ where: { organizationId } });
      await transaction.ledgerEntry.deleteMany({ where: { organizationId } });
      await transaction.ledgerTransaction.deleteMany({
        where: { organizationId },
      });
      await transaction.loan.deleteMany({ where: { organizationId } });
      await transaction.lendingOffer.deleteMany({ where: { organizationId } });
      await transaction.ledgerAccount.deleteMany({ where: { organizationId } });
      await transaction.organization.delete({ where: { id: organizationId } });
    });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
}
