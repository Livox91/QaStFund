import "dotenv/config";

import { randomUUID } from "node:crypto";

import { prisma } from "../src/infrastructure/database/prisma";
import { prismaEmployeeLoanRepository } from "../src/modules/loans/infrastructure/prisma-employee-loan-repository";
import { prismaLoanLifecycleRepository } from "../src/modules/loans/infrastructure/prisma-loan-lifecycle-repository";
import { fundEmployeeWallet } from "../src/modules/ledger/infrastructure/prisma-wallet-repository";

const suffix = randomUUID();
let organizationId: string | undefined;
const userIds: string[] = [];

try {
  const organization = await prisma.organization.create({
    data: {
      name: "Repayment concurrency verification",
      slug: `repayment-${suffix}`,
      currency: "USD",
    },
  });
  organizationId = organization.id;
  const testOrganizationId = organization.id;
  const users = await Promise.all(
    ["Borrower", "Lender", "Unrelated", "Admin"].map((name) =>
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
  const [borrower, lender, unrelated, admin] = users;
  if (!borrower || !lender || !unrelated || !admin)
    throw new Error("Test users missing.");

  const memberships = await Promise.all(
    users.map((user) =>
      prisma.organizationMembership.create({
        data: {
          organizationId: testOrganizationId,
          userId: user.id,
          role: user.id === admin.id ? "EMPLOYER_ADMIN" : "EMPLOYEE",
        },
      }),
    ),
  );
  const [borrowerMembership, lenderMembership, , adminMembership] = memberships;
  if (!borrowerMembership || !lenderMembership || !adminMembership) {
    throw new Error("Test memberships missing.");
  }
  await fundEmployeeWallet({
    organizationId: testOrganizationId,
    userId: borrower.id,
    amountMinorUnits: 20_000n,
    requestId: randomUUID(),
    now: new Date(),
  });

  const activatedAt = new Date();
  const terms = {
    principalAmountMinorUnits: 2_000n,
    feeAmountMinorUnits: 0n,
    durationDays: 30,
    feeRateBasisPoints: 0,
    activatedAt,
    repaymentDueAt: new Date(activatedAt.getTime() + 30 * 86_400_000),
  };
  const loan = await prisma.loan.create({
    data: {
      organizationId: testOrganizationId,
      lenderMembershipId: lenderMembership.id,
      borrowerMembershipId: borrowerMembership.id,
      ...terms,
      outstandingPrincipalMinorUnits: terms.principalAmountMinorUnits,
      currency: "USD",
      status: "ACTIVE",
      requestedAt: activatedAt,
      approvedAt: activatedAt,
      startedAt: activatedAt,
    },
  });
  const attempts = [randomUUID(), randomUUID()].map((requestId) => ({
    organizationId: testOrganizationId,
    userId: borrower.id,
    command: {
      loanId: loan.id,
      amountMinorUnits: 2_000n,
      requestId,
    },
    now: new Date(),
  }));
  const results = await Promise.all(
    attempts.map((attempt) =>
      prismaEmployeeLoanRepository.repayBorrowedLoan(attempt),
    ),
  );
  const successIndex = results.findIndex(({ kind }) => kind === "RECORDED");
  const successfulAttempt = attempts[successIndex];
  if (!successfulAttempt) throw new Error("Successful repayment missing.");
  const retry =
    await prismaEmployeeLoanRepository.repayBorrowedLoan(successfulAttempt);

  const [updatedLoan, repayments, auditEvents] = await Promise.all([
    prisma.loan.findUniqueOrThrow({ where: { id: loan.id } }),
    prisma.loanRepayment.findMany({ where: { loanId: loan.id } }),
    prisma.auditEvent.findMany({ where: { loanId: loan.id } }),
  ]);
  const completedTotal = repayments
    .filter(({ status }) => status === "COMPLETED")
    .reduce((total, repayment) => total + repayment.amountMinorUnits, 0n);
  const createdCount = results.filter(({ kind }) => kind === "RECORDED").length;
  const rejectedCount = results.filter(
    ({ kind }) => kind === "LOAN_NOT_REPAYABLE",
  ).length;

  if (
    createdCount !== 1 ||
    rejectedCount !== 1 ||
    repayments.length !== 1 ||
    repayments[0]?.status !== "COMPLETED" ||
    !repayments[0]?.completedAt ||
    completedTotal !== 2_000n ||
    updatedLoan.status !== "REPAID" ||
    !updatedLoan.closedAt ||
    updatedLoan.outstandingPrincipalMinorUnits !== 0n ||
    retry.kind !== "ALREADY_RECORDED" ||
    auditEvents.filter(({ type }) => type === "REPAYMENT_CREATED").length !==
      1 ||
    auditEvents.filter(({ type }) => type === "REPAYMENT_COMPLETED").length !==
      1 ||
    auditEvents.filter(({ type }) => type === "LOAN_REPAID").length !== 1 ||
    updatedLoan.principalAmountMinorUnits !== terms.principalAmountMinorUnits ||
    updatedLoan.feeAmountMinorUnits !== terms.feeAmountMinorUnits ||
    updatedLoan.durationDays !== terms.durationDays ||
    updatedLoan.feeRateBasisPoints !== terms.feeRateBasisPoints ||
    updatedLoan.activatedAt?.getTime() !== terms.activatedAt.getTime() ||
    updatedLoan.repaymentDueAt.getTime() !== terms.repaymentDueAt.getTime()
  ) {
    throw new Error("Concurrent repayment verification failed.");
  }

  const inaccessibleResults = await Promise.all([
    prismaEmployeeLoanRepository.repayBorrowedLoan({
      ...successfulAttempt,
      userId: lender.id,
      command: { ...successfulAttempt.command, requestId: randomUUID() },
    }),
    prismaEmployeeLoanRepository.repayBorrowedLoan({
      ...successfulAttempt,
      userId: unrelated.id,
      command: { ...successfulAttempt.command, requestId: randomUUID() },
    }),
    prismaEmployeeLoanRepository.repayBorrowedLoan({
      ...successfulAttempt,
      organizationId: randomUUID(),
      command: { ...successfulAttempt.command, requestId: randomUUID() },
    }),
  ]);
  if (inaccessibleResults.some(({ kind }) => kind !== "LOAN_NOT_FOUND")) {
    throw new Error("Repayment participant isolation verification failed.");
  }

  const partialLoan = await prisma.loan.create({
    data: {
      organizationId: testOrganizationId,
      lenderMembershipId: lenderMembership.id,
      borrowerMembershipId: borrowerMembership.id,
      principalAmountMinorUnits: 5_000n,
      feeAmountMinorUnits: 150n,
      outstandingPrincipalMinorUnits: 5_000n,
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 300,
      status: "ACTIVE",
      requestedAt: activatedAt,
      approvedAt: activatedAt,
      activatedAt,
      startedAt: activatedAt,
      repaymentDueAt: terms.repaymentDueAt,
    },
  });
  const partial = await prismaEmployeeLoanRepository.repayBorrowedLoan({
    organizationId: testOrganizationId,
    userId: borrower.id,
    command: {
      loanId: partialLoan.id,
      amountMinorUnits: 2_000n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });
  const afterPartial = await prisma.loan.findUniqueOrThrow({
    where: { id: partialLoan.id },
  });
  const overpayment = await prismaEmployeeLoanRepository.repayBorrowedLoan({
    organizationId: testOrganizationId,
    userId: borrower.id,
    command: {
      loanId: partialLoan.id,
      amountMinorUnits: 3_151n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });
  const countAfterRejection = await prisma.loanRepayment.count({
    where: { loanId: partialLoan.id },
  });
  const final = await prismaEmployeeLoanRepository.repayBorrowedLoan({
    organizationId: testOrganizationId,
    userId: borrower.id,
    command: {
      loanId: partialLoan.id,
      amountMinorUnits: 3_150n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });
  const afterFinal = await prisma.loan.findUniqueOrThrow({
    where: { id: partialLoan.id },
  });
  if (
    partial.kind !== "RECORDED" ||
    afterPartial.status !== "ACTIVE" ||
    overpayment.kind !== "AMOUNT_EXCEEDS_REMAINING" ||
    overpayment.remainingAmountMinorUnits !== 3_150n ||
    countAfterRejection !== 1 ||
    final.kind !== "RECORDED" ||
    afterFinal.status !== "REPAID" ||
    afterFinal.outstandingPrincipalMinorUnits !== 0n
  ) {
    throw new Error(
      "Partial, full, or rollback repayment verification failed.",
    );
  }

  const terminalLoans = await Promise.all(
    (["CANCELLED", "DEFAULTED"] as const).map((status) =>
      prisma.loan.create({
        data: {
          organizationId: testOrganizationId,
          lenderMembershipId: lenderMembership.id,
          borrowerMembershipId: borrowerMembership.id,
          principalAmountMinorUnits: 1_000n,
          feeAmountMinorUnits: 0n,
          outstandingPrincipalMinorUnits: 1_000n,
          currency: "USD",
          durationDays: 10,
          feeRateBasisPoints: 0,
          status,
          requestedAt: activatedAt,
          approvedAt: status === "DEFAULTED" ? activatedAt : null,
          activatedAt: status === "DEFAULTED" ? activatedAt : null,
          closedAt: activatedAt,
          startedAt: activatedAt,
          repaymentDueAt: terms.repaymentDueAt,
        },
      }),
    ),
  );
  const terminalResults = await Promise.all(
    terminalLoans.map((terminalLoan) =>
      prismaEmployeeLoanRepository.repayBorrowedLoan({
        organizationId: testOrganizationId,
        userId: borrower.id,
        command: {
          loanId: terminalLoan.id,
          amountMinorUnits: 100n,
          requestId: randomUUID(),
        },
        now: new Date(),
      }),
    ),
  );
  if (terminalResults.some(({ kind }) => kind !== "LOAN_NOT_REPAYABLE")) {
    throw new Error("Terminal repayment state verification failed.");
  }

  const overdueDueAt = new Date(activatedAt.getTime() - 86_400_000);
  const [overdueCandidate, repaidPastDue] = await Promise.all([
    prisma.loan.create({
      data: {
        organizationId: testOrganizationId,
        lenderMembershipId: lenderMembership.id,
        borrowerMembershipId: borrowerMembership.id,
        principalAmountMinorUnits: 1_000n,
        feeAmountMinorUnits: 0n,
        outstandingPrincipalMinorUnits: 1_000n,
        currency: "USD",
        durationDays: 10,
        feeRateBasisPoints: 0,
        status: "ACTIVE",
        requestedAt: activatedAt,
        approvedAt: activatedAt,
        activatedAt,
        startedAt: activatedAt,
        repaymentDueAt: overdueDueAt,
      },
    }),
    prisma.loan.create({
      data: {
        organizationId: testOrganizationId,
        lenderMembershipId: lenderMembership.id,
        borrowerMembershipId: borrowerMembership.id,
        principalAmountMinorUnits: 1_000n,
        feeAmountMinorUnits: 0n,
        outstandingPrincipalMinorUnits: 0n,
        currency: "USD",
        durationDays: 10,
        feeRateBasisPoints: 0,
        status: "REPAID",
        requestedAt: activatedAt,
        approvedAt: activatedAt,
        activatedAt,
        closedAt: activatedAt,
        startedAt: activatedAt,
        repaymentDueAt: overdueDueAt,
      },
    }),
  ]);
  const overdueCount = await prismaLoanLifecycleRepository.markOverdue({
    organizationId: testOrganizationId,
    actorUserId: admin.id,
    now: new Date(),
  });
  const [markedOverdue, stillRepaid, overdueAudit] = await Promise.all([
    prisma.loan.findUniqueOrThrow({ where: { id: overdueCandidate.id } }),
    prisma.loan.findUniqueOrThrow({ where: { id: repaidPastDue.id } }),
    prisma.auditEvent.findFirst({
      where: { loanId: overdueCandidate.id, type: "LOAN_MARKED_OVERDUE" },
    }),
  ]);
  if (
    overdueCount !== 1 ||
    markedOverdue.status !== "OVERDUE" ||
    stillRepaid.status !== "REPAID" ||
    overdueAudit?.actorMembershipId !== adminMembership.id
  ) {
    throw new Error("Overdue lifecycle verification failed.");
  }

  console.log(
    "Repayment concurrency, lifecycle, rollback, idempotency, and tenant rules verified.",
  );
} finally {
  if (organizationId) {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('app.allow_ledger_cleanup', 'on', true)`;
      await transaction.auditEvent.deleteMany({ where: { organizationId } });
      await transaction.ledgerEntry.deleteMany({ where: { organizationId } });
      await transaction.ledgerTransaction.deleteMany({
        where: { organizationId },
      });
      await transaction.loanRepayment.deleteMany({ where: { organizationId } });
      await transaction.loan.deleteMany({ where: { organizationId } });
      await transaction.lendingOffer.deleteMany({ where: { organizationId } });
      await transaction.ledgerAccount.deleteMany({ where: { organizationId } });
      await transaction.employeeBalance.deleteMany({
        where: { organizationId },
      });
      await transaction.organization.delete({ where: { id: organizationId } });
    });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
}
