import "dotenv/config";

import { randomUUID } from "node:crypto";

import { prisma } from "../src/infrastructure/database/prisma";
import { prismaBorrowLoanRepository } from "../src/modules/loans/infrastructure/prisma-borrow-loan-repository";

const suffix = randomUUID();
let organizationId: string | undefined;
const userIds: string[] = [];

try {
  const organization = await prisma.organization.create({
    data: {
      name: "Borrow verification",
      slug: `borrow-${suffix}`,
      currency: "USD",
    },
  });
  organizationId = organization.id;
  const borrower = await prisma.user.create({
    data: {
      email: `borrower-${suffix}@test.local`,
      name: "Borrower",
      passwordHash: "unused",
    },
  });
  const lender = await prisma.user.create({
    data: {
      email: `lender-${suffix}@test.local`,
      name: "Lender",
      passwordHash: "unused",
    },
  });
  userIds.push(borrower.id, lender.id);
  const borrowerMembership = await prisma.organizationMembership.create({
    data: { organizationId, userId: borrower.id, role: "EMPLOYEE" },
  });
  const lenderMembership = await prisma.organizationMembership.create({
    data: { organizationId, userId: lender.id, role: "EMPLOYEE" },
  });
  await prisma.employeeBalance.createMany({
    data: [
      {
        organizationId,
        membershipId: borrowerMembership.id,
        amountMinorUnits: 20_000n,
        currency: "USD",
      },
      {
        organizationId,
        membershipId: lenderMembership.id,
        amountMinorUnits: 100_000n,
        currency: "USD",
      },
    ],
  });
  const offer = await prisma.lendingOffer.create({
    data: {
      organizationId,
      lenderMembershipId: lenderMembership.id,
      amountMinorUnits: 50_000n,
      availableAmountMinorUnits: 50_000n,
      minimumLoanAmountMinorUnits: 5_000n,
      maximumLoanAmountMinorUnits: 25_000n,
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 500,
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "ACTIVE",
    },
  });
  const command = {
    offerId: offer.id,
    amountMinorUnits: 10_000n,
    requestId: randomUUID(),
  };
  const now = new Date();
  const selfOffer = await prismaBorrowLoanRepository.findBorrowableOffer({
    organizationId,
    userId: lender.id,
    offerId: offer.id,
    now,
  });
  const crossOrganizationOffer =
    await prismaBorrowLoanRepository.findBorrowableOffer({
      organizationId: randomUUID(),
      userId: borrower.id,
      offerId: offer.id,
      now,
    });
  const first = await prismaBorrowLoanRepository.createFromOffer({
    organizationId,
    userId: borrower.id,
    command,
    now,
  });
  const retry = await prismaBorrowLoanRepository.createFromOffer({
    organizationId,
    userId: borrower.id,
    command,
    now,
  });
  const [loanCount, balances, updatedOffer, ledgerEntries, auditCount] =
    await Promise.all([
      prisma.loan.count({ where: { borrowRequestId: command.requestId } }),
      prisma.employeeBalance.findMany({
        where: { organizationId },
        orderBy: { membershipId: "asc" },
      }),
      prisma.lendingOffer.findUniqueOrThrow({ where: { id: offer.id } }),
      prisma.ledgerEntry.findMany({ where: { organizationId } }),
      prisma.auditEvent.count({ where: { organizationId } }),
    ]);
  const borrowerBalance = balances.find(
    (item) => item.membershipId === borrowerMembership.id,
  );
  const lenderBalance = balances.find(
    (item) => item.membershipId === lenderMembership.id,
  );
  const debits = ledgerEntries
    .filter((entry) => entry.direction === "DEBIT")
    .reduce((sum, entry) => sum + entry.amountMinorUnits, 0n);
  const credits = ledgerEntries
    .filter((entry) => entry.direction === "CREDIT")
    .reduce((sum, entry) => sum + entry.amountMinorUnits, 0n);

  if (
    first.kind !== "CREATED" ||
    retry.kind !== "ALREADY_CREATED" ||
    selfOffer !== null ||
    crossOrganizationOffer !== null ||
    loanCount !== 1 ||
    borrowerBalance?.amountMinorUnits !== 30_000n ||
    lenderBalance?.amountMinorUnits !== 90_000n ||
    updatedOffer.availableAmountMinorUnits !== 40_000n ||
    ledgerEntries.length !== 2 ||
    debits !== credits ||
    auditCount !== 1
  ) {
    throw new Error("Borrowing transaction verification failed.");
  }

  console.log(
    "Borrowing transaction, tenant isolation, and idempotent retry verified.",
  );
} finally {
  if (organizationId) {
    await prisma.ledgerEntry.deleteMany({ where: { organizationId } });
    await prisma.ledgerTransaction.deleteMany({ where: { organizationId } });
    await prisma.auditEvent.deleteMany({ where: { organizationId } });
    await prisma.loan.deleteMany({ where: { organizationId } });
    await prisma.lendingOffer.deleteMany({ where: { organizationId } });
    await prisma.ledgerAccount.deleteMany({ where: { organizationId } });
    await prisma.employeeBalance.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}
