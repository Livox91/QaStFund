import "dotenv/config";

import { randomUUID } from "node:crypto";

import { prisma } from "../src/infrastructure/database/prisma";
import { fundEmployeeWallet } from "../src/modules/ledger/infrastructure/prisma-wallet-repository";
import { prismaLendingOfferRepository } from "../src/modules/lending/infrastructure/prisma-lending-offer-repository";
import { prismaBorrowLoanRepository } from "../src/modules/loans/infrastructure/prisma-borrow-loan-repository";
import { prismaEmployeeLoanRepository } from "../src/modules/loans/infrastructure/prisma-employee-loan-repository";
import { DEFAULT_LENDING_POLICY } from "../src/modules/policies/domain/lending-policy";
import {
  getEmployeeBorrowingCapacity,
  updateEmployeeLendingAccess,
  updateOrganizationPolicy,
} from "../src/modules/policies/infrastructure/prisma-lending-policy-repository";

const suffix = randomUUID();
let organizationId: string | undefined;
const userIds: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  const organization = await prisma.organization.create({
    data: {
      name: "Policy verification",
      slug: `policy-${suffix}`,
      currency: "USD",
    },
  });
  organizationId = organization.id;
  const users = await Promise.all(
    ["Admin", "Alice", "Bob", "Charlie"].map((name) =>
      prisma.user.create({
        data: {
          email: `${name.toLowerCase()}-${suffix}@policy.test`,
          name,
          passwordHash: "unused",
        },
      }),
    ),
  );
  userIds.push(...users.map(({ id }) => id));
  const [admin, alice, bob, charlie] = users;
  assert(
    admin && alice && bob && charlie,
    "Policy verification users missing.",
  );
  const memberships = await Promise.all(
    users.map((user) =>
      prisma.organizationMembership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: user.id === admin.id ? "EMPLOYER_ADMIN" : "EMPLOYEE",
        },
      }),
    ),
  );
  const [, aliceMembership, bobMembership] = memberships;
  assert(
    aliceMembership && bobMembership,
    "Policy verification memberships missing.",
  );

  const configured = await updateOrganizationPolicy({
    organizationId: organization.id,
    actorUserId: admin.id,
    now: new Date(),
    values: {
      ...DEFAULT_LENDING_POLICY,
      maxLoanAmountMinorUnits: 10_000n,
      maxOutstandingDebtMinorUnits: 15_000n,
      maxActiveLoans: 2,
      maxInterestRateBasisPoints: 500,
      minTermDays: 7,
      maxTermDays: 30,
    },
  });
  assert(configured?.policyVersion === 2, "Employer policy update failed.");

  await fundEmployeeWallet({
    organizationId: organization.id,
    userId: alice.id,
    amountMinorUnits: 50_000n,
    requestId: randomUUID(),
    now: new Date(),
  });
  const offerResult = await prismaLendingOfferRepository.createForEmployee({
    organizationId: organization.id,
    userId: alice.id,
    now: new Date(),
    command: {
      amountMinorUnits: 50_000n,
      minimumLoanAmountMinorUnits: 100n,
      maximumLoanAmountMinorUnits: 10_000n,
      durationDays: 30,
      feeRateBasisPoints: 300,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  assert(
    offerResult.kind === "CREATED",
    "Policy-compliant offer was rejected.",
  );

  const borrow = (amountMinorUnits: bigint) =>
    prismaBorrowLoanRepository.createFromOffer({
      organizationId: organization.id,
      userId: bob.id,
      command: {
        offerId: offerResult.offer.id,
        amountMinorUnits,
        requestId: randomUUID(),
      },
      now: new Date(),
    });
  const first = await borrow(10_000n);
  assert(first.kind === "CREATED", "First policy-compliant loan failed.");
  const secondBeforeRepayment = await borrow(10_000n);
  assert(
    secondBeforeRepayment.kind === "POLICY_VIOLATION" &&
      secondBeforeRepayment.violation === "OUTSTANDING_DEBT_EXCEEDED",
    "Outstanding debt policy was not enforced.",
  );

  const repayment = await prismaEmployeeLoanRepository.repayBorrowedLoan({
    organizationId: organization.id,
    userId: bob.id,
    command: {
      loanId: first.loan.id,
      amountMinorUnits: 6_000n,
      requestId: randomUUID(),
    },
    now: new Date(),
  });
  assert(repayment.kind === "RECORDED", "Policy end-to-end repayment failed.");
  const capacity = await getEmployeeBorrowingCapacity({
    organizationId: organization.id,
    userId: bob.id,
  });
  assert(
    capacity?.outstandingDebtMinorUnits === 4_300n,
    "Remaining debt capacity is wrong.",
  );
  const second = await borrow(10_000n);
  assert(
    second.kind === "CREATED",
    "Borrow after repayment should have succeeded.",
  );
  const storedLoan = await prisma.loan.findUniqueOrThrow({
    where: { id: second.loan.id },
  });
  assert(
    storedLoan.policyVersion === configured.policyVersion &&
      storedLoan.policySnapshot,
    "Loan policy snapshot missing.",
  );

  await updateEmployeeLendingAccess({
    organizationId: organization.id,
    actorUserId: admin.id,
    employeeMembershipId: bobMembership.id,
    canBorrow: false,
    canLend: true,
    now: new Date(),
  });
  const suspendedBorrow = await borrow(100n);
  assert(
    suspendedBorrow.kind === "POLICY_VIOLATION" &&
      suspendedBorrow.violation === "EMPLOYEE_CANNOT_BORROW",
    "Suspended borrower created a loan.",
  );
  const suspendedRepayment =
    await prismaEmployeeLoanRepository.repayBorrowedLoan({
      organizationId: organization.id,
      userId: bob.id,
      command: {
        loanId: second.loan.id,
        amountMinorUnits: 100n,
        requestId: randomUUID(),
      },
      now: new Date(),
    });
  assert(
    suspendedRepayment.kind === "RECORDED",
    "Suspension prevented repayment.",
  );

  await updateEmployeeLendingAccess({
    organizationId: organization.id,
    actorUserId: admin.id,
    employeeMembershipId: aliceMembership.id,
    canBorrow: true,
    canLend: false,
    now: new Date(),
  });
  const suspendedOffer = await prismaLendingOfferRepository.createForEmployee({
    organizationId: organization.id,
    userId: alice.id,
    now: new Date(),
    command: {
      amountMinorUnits: 1_000n,
      minimumLoanAmountMinorUnits: 100n,
      maximumLoanAmountMinorUnits: 1_000n,
      durationDays: 30,
      feeRateBasisPoints: 300,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  assert(
    suspendedOffer.kind === "POLICY_VIOLATION",
    "Suspended lender created an offer.",
  );

  await updateEmployeeLendingAccess({
    organizationId: organization.id,
    actorUserId: admin.id,
    employeeMembershipId: aliceMembership.id,
    canBorrow: true,
    canLend: true,
    now: new Date(),
  });
  await updateEmployeeLendingAccess({
    organizationId: organization.id,
    actorUserId: admin.id,
    employeeMembershipId: bobMembership.id,
    canBorrow: true,
    canLend: true,
    now: new Date(),
  });
  const concurrencyPolicy = await updateOrganizationPolicy({
    organizationId: organization.id,
    actorUserId: admin.id,
    now: new Date(),
    values: {
      ...DEFAULT_LENDING_POLICY,
      maxLoanAmountMinorUnits: 10_000n,
      maxOutstandingDebtMinorUnits: 10_000n,
    },
  });
  assert(concurrencyPolicy, "Concurrency policy update failed.");
  const zeroFeeOffer = await prismaLendingOfferRepository.createForEmployee({
    organizationId: organization.id,
    userId: alice.id,
    now: new Date(),
    command: {
      amountMinorUnits: 20_000n,
      minimumLoanAmountMinorUnits: 10_000n,
      maximumLoanAmountMinorUnits: 10_000n,
      durationDays: 30,
      feeRateBasisPoints: 0,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  assert(zeroFeeOffer.kind === "CREATED", "Concurrency offer failed.");
  const concurrent = await Promise.all(
    [randomUUID(), randomUUID()].map((requestId) =>
      prismaBorrowLoanRepository.createFromOffer({
        organizationId: organization.id,
        userId: charlie.id,
        command: {
          offerId: zeroFeeOffer.offer.id,
          amountMinorUnits: 10_000n,
          requestId,
        },
        now: new Date(),
      }),
    ),
  );
  assert(
    concurrent.filter(({ kind }) => kind === "CREATED").length === 1,
    "Concurrent policy limit allowed multiple loans.",
  );
  const charlieCapacity = await getEmployeeBorrowingCapacity({
    organizationId: organization.id,
    userId: charlie.id,
  });
  assert(
    charlieCapacity?.outstandingDebtMinorUnits === 10_000n,
    "Concurrent debt exceeded policy.",
  );

  const auditTypes = await prisma.auditEvent.findMany({
    where: { organizationId: organization.id },
    select: { type: true },
  });
  assert(
    auditTypes.some(({ type }) => type === "LENDING_POLICY_UPDATED"),
    "Policy audit missing.",
  );
  assert(
    auditTypes.some(({ type }) => type === "EMPLOYEE_BORROWING_SUSPENDED"),
    "Eligibility audit missing.",
  );
  console.log(
    "Employer policy controls, eligibility, transactional enforcement, concurrency, audit, and end-to-end policy flow verified.",
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
      await transaction.organization.deleteMany({
        where: { id: organizationId },
      });
    });
  }
  if (userIds.length)
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}
