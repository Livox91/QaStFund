import "dotenv/config";

import { randomUUID } from "node:crypto";

import { prisma } from "../src/infrastructure/database/prisma";
import { prismaBorrowLoanRepository } from "../src/modules/loans/infrastructure/prisma-borrow-loan-repository";
import { prismaEmployeeLoanRepository } from "../src/modules/loans/infrastructure/prisma-employee-loan-repository";

const suffix = randomUUID();
let organizationId: string | undefined;
const userIds: string[] = [];

try {
  const organization = await prisma.organization.create({
    data: {
      name: "Repayment verification",
      slug: `repayment-${suffix}`,
      currency: "USD",
    },
  });
  organizationId = organization.id;
  const borrower = await prisma.user.create({
    data: {
      email: `repayment-borrower-${suffix}@test.local`,
      name: "Borrower",
      passwordHash: "unused",
    },
  });
  const lender = await prisma.user.create({
    data: {
      email: `repayment-lender-${suffix}@test.local`,
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
  const borrowed = await prismaBorrowLoanRepository.createFromOffer({
    organizationId,
    userId: borrower.id,
    command: {
      offerId: offer.id,
      amountMinorUnits: 10_000n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });

  if (borrowed.kind !== "CREATED") {
    throw new Error("Could not create the verification loan.");
  }

  const partialCommand = {
    loanId: borrowed.loan.id,
    amountMinorUnits: 500n,
    requestId: randomUUID(),
  };
  const partial = await prismaEmployeeLoanRepository.repayBorrowedLoan({
    organizationId,
    userId: borrower.id,
    command: partialCommand,
    now: new Date(),
  });
  const retry = await prismaEmployeeLoanRepository.repayBorrowedLoan({
    organizationId,
    userId: borrower.id,
    command: partialCommand,
    now: new Date(),
  });
  const rejectedOverpayment =
    await prismaEmployeeLoanRepository.repayBorrowedLoan({
      organizationId,
      userId: borrower.id,
      command: {
        loanId: borrowed.loan.id,
        amountMinorUnits: 20_000n,
        requestId: randomUUID(),
      },
      now: new Date(),
    });
  const repaymentCountAfterRejection = await prisma.loanRepayment.count({
    where: { organizationId },
  });
  const final = await prismaEmployeeLoanRepository.repayBorrowedLoan({
    organizationId,
    userId: borrower.id,
    command: {
      loanId: borrowed.loan.id,
      amountMinorUnits: 10_000n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });

  const [
    loan,
    balances,
    repayments,
    ledgerTransactions,
    ledgerEntries,
    auditCount,
    borrowerDetails,
    lenderDetails,
    foreignDetails,
  ] = await Promise.all([
    prisma.loan.findUniqueOrThrow({ where: { id: borrowed.loan.id } }),
    prisma.employeeBalance.findMany({ where: { organizationId } }),
    prisma.loanRepayment.findMany({
      where: { organizationId },
      orderBy: { paidAt: "asc" },
    }),
    prisma.ledgerTransaction.findMany({ where: { organizationId } }),
    prisma.ledgerEntry.findMany({ where: { organizationId } }),
    prisma.auditEvent.count({ where: { organizationId } }),
    prismaEmployeeLoanRepository.findBorrowedLoan({
      organizationId,
      userId: borrower.id,
      loanId: borrowed.loan.id,
    }),
    prismaEmployeeLoanRepository.findBorrowedLoan({
      organizationId,
      userId: lender.id,
      loanId: borrowed.loan.id,
    }),
    prismaEmployeeLoanRepository.findBorrowedLoan({
      organizationId: randomUUID(),
      userId: borrower.id,
      loanId: borrowed.loan.id,
    }),
  ]);
  const borrowerBalance = balances.find(
    (balance) => balance.membershipId === borrowerMembership.id,
  );
  const lenderBalance = balances.find(
    (balance) => balance.membershipId === lenderMembership.id,
  );
  const repaymentTransactions = ledgerTransactions.filter(
    (transaction) => transaction.type === "LOAN_REPAYMENT",
  );
  const repaymentTransactionIds = new Set(
    repaymentTransactions.map((transaction) => transaction.id),
  );
  const repaymentEntries = ledgerEntries.filter((entry) =>
    repaymentTransactionIds.has(entry.transactionId),
  );
  const repaymentDebits = repaymentEntries
    .filter((entry) => entry.direction === "DEBIT")
    .reduce((sum, entry) => sum + entry.amountMinorUnits, 0n);
  const repaymentCredits = repaymentEntries
    .filter((entry) => entry.direction === "CREDIT")
    .reduce((sum, entry) => sum + entry.amountMinorUnits, 0n);

  if (
    partial.kind !== "RECORDED" ||
    retry.kind !== "ALREADY_RECORDED" ||
    rejectedOverpayment.kind !== "AMOUNT_EXCEEDS_REMAINING" ||
    repaymentCountAfterRejection !== 1 ||
    final.kind !== "RECORDED" ||
    final.repayment.loanStatus !== "REPAID" ||
    loan.status !== "REPAID" ||
    loan.outstandingPrincipalMinorUnits !== 0n ||
    borrowerBalance?.amountMinorUnits !== 19_500n ||
    lenderBalance?.amountMinorUnits !== 100_500n ||
    repayments.length !== 2 ||
    repaymentTransactions.length !== 2 ||
    repaymentEntries.length !== 4 ||
    repaymentDebits !== 10_500n ||
    repaymentCredits !== repaymentDebits ||
    auditCount !== 4 ||
    borrowerDetails?.repayments.length !== 2 ||
    lenderDetails !== null ||
    foreignDetails !== null
  ) {
    throw new Error("Manual repayment verification failed.");
  }

  console.log(
    "Partial/full repayment, rollback, ledger balance, tenant isolation, and idempotency verified.",
  );
} finally {
  if (organizationId) {
    await prisma.ledgerEntry.deleteMany({ where: { organizationId } });
    await prisma.ledgerTransaction.deleteMany({ where: { organizationId } });
    await prisma.loanRepayment.deleteMany({ where: { organizationId } });
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
