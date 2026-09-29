import "dotenv/config";

import { scryptPasswordHasher } from "../src/modules/auth/infrastructure/scrypt-password-hasher";
import { prisma } from "../src/infrastructure/database/prisma";
import {
  ensurePlatformFundingAccount,
  ensureUserWallet,
  lockLedgerAccounts,
  postLedgerTransaction,
} from "../src/modules/ledger/infrastructure/ledger-posting";

const DEMO_ORGANIZATION = {
  name: "Acme Corp",
  slug: "acme-corp",
  currency: "USD",
};

const DEMO_USERS = [
  {
    email: "admin@acme.test",
    name: "Acme Employer Admin",
    password: "AcmeAdmin123!",
    role: "EMPLOYER_ADMIN" as const,
  },
  {
    email: "alice@acme.test",
    name: "Alice Carter",
    password: "AcmeEmployee123!",
    role: "EMPLOYEE" as const,
  },
  {
    email: "bob@acme.test",
    name: "Bob Lee",
    password: "AcmeEmployee123!",
    role: "EMPLOYEE" as const,
  },
  {
    email: "charlie@acme.test",
    name: "Charlie Rivera",
    password: "AcmeEmployee123!",
    role: "EMPLOYEE" as const,
  },
];

function dateFromNow(now: Date, days: number, hours = 0): Date {
  return new Date(
    now.getTime() + days * 24 * 60 * 60 * 1_000 + hours * 60 * 60 * 1_000,
  );
}

async function seed(): Promise<void> {
  const now = new Date();
  const organization = await prisma.organization.upsert({
    where: { slug: DEMO_ORGANIZATION.slug },
    update: {
      name: DEMO_ORGANIZATION.name,
      currency: DEMO_ORGANIZATION.currency,
    },
    create: DEMO_ORGANIZATION,
  });

  const membershipIds = new Map<string, string>();

  for (const demoUser of DEMO_USERS) {
    const passwordHash = await scryptPasswordHasher.hash(demoUser.password);
    const user = await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {
        name: demoUser.name,
        passwordHash,
      },
      create: {
        email: demoUser.email,
        name: demoUser.name,
        passwordHash,
      },
    });

    await prisma.session.deleteMany({ where: { userId: user.id } });

    const membership = await prisma.organizationMembership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
      update: {
        role: demoUser.role,
        isActive: true,
      },
      create: {
        organizationId: organization.id,
        userId: user.id,
        role: demoUser.role,
      },
    });

    membershipIds.set(demoUser.email, membership.id);
  }

  const membershipId = (email: string): string => {
    const id = membershipIds.get(email);

    if (!id) throw new Error(`Missing seeded membership for ${email}.`);

    return id;
  };

  const mockBalances = [
    { email: "alice@acme.test", amountMinorUnits: 500_000n },
    { email: "bob@acme.test", amountMinorUnits: 1_000_000n },
    { email: "charlie@acme.test", amountMinorUnits: 250_000n },
  ];

  for (const balance of mockBalances) {
    const balanceScope = {
      organizationId: organization.id,
      membershipId: membershipId(balance.email),
    };

    await prisma.employeeBalance.upsert({
      where: { organizationId_membershipId: balanceScope },
      update: {
        amountMinorUnits: balance.amountMinorUnits,
        currency: organization.currency,
      },
      create: {
        ...balanceScope,
        amountMinorUnits: balance.amountMinorUnits,
        currency: organization.currency,
      },
    });
  }

  const fundingReferences = new Map([
    ["alice@acme.test", "33000000-0000-4000-8000-000000000001"],
    ["bob@acme.test", "33000000-0000-4000-8000-000000000002"],
    ["charlie@acme.test", "33000000-0000-4000-8000-000000000003"],
  ]);
  for (const balance of mockBalances) {
    const referenceId = fundingReferences.get(balance.email);
    if (!referenceId)
      throw new Error(`Missing funding reference for ${balance.email}.`);
    await prisma.$transaction(async (transaction) => {
      const wallet = await ensureUserWallet(transaction, {
        organizationId: organization.id,
        membershipId: membershipId(balance.email),
      });
      const platform = await ensurePlatformFundingAccount(
        transaction,
        organization.id,
      );
      await lockLedgerAccounts(transaction, organization.id, [
        wallet.id,
        platform.id,
      ]);
      await postLedgerTransaction(transaction, {
        organizationId: organization.id,
        type: "DEPOSIT",
        referenceType: "DEVELOPMENT_FUNDING",
        referenceId,
        idempotencyKey: `seed-funding:${balance.email}`,
        now,
        accountsAlreadyLocked: true,
        entries: [
          {
            accountId: platform.id,
            direction: "DEBIT",
            amountMinorUnits: balance.amountMinorUnits,
          },
          {
            accountId: wallet.id,
            direction: "CREDIT",
            amountMinorUnits: balance.amountMinorUnits,
          },
        ],
      });
    });
  }

  const offers = [
    {
      id: "11000000-0000-4000-8000-000000000001",
      lenderMembershipId: membershipId("bob@acme.test"),
      amountMinorUnits: 300_000n,
      availableAmountMinorUnits: 250_000n,
      minimumLoanAmountMinorUnits: 50_000n,
      maximumLoanAmountMinorUnits: 150_000n,
      durationDays: 30,
      feeRateBasisPoints: 500,
      expiresAt: dateFromNow(now, 45),
      status: "ACTIVE" as const,
    },
    {
      id: "11000000-0000-4000-8000-000000000002",
      lenderMembershipId: membershipId("bob@acme.test"),
      amountMinorUnits: 150_000n,
      availableAmountMinorUnits: 125_000n,
      minimumLoanAmountMinorUnits: 25_000n,
      maximumLoanAmountMinorUnits: 75_000n,
      durationDays: 21,
      feeRateBasisPoints: 350,
      expiresAt: dateFromNow(now, 30),
      status: "ACTIVE" as const,
    },
    {
      id: "11000000-0000-4000-8000-000000000003",
      lenderMembershipId: membershipId("alice@acme.test"),
      amountMinorUnits: 100_000n,
      availableAmountMinorUnits: 40_000n,
      minimumLoanAmountMinorUnits: 10_000n,
      maximumLoanAmountMinorUnits: 40_000n,
      durationDays: 14,
      feeRateBasisPoints: 400,
      expiresAt: dateFromNow(now, 21),
      status: "ACTIVE" as const,
    },
  ];

  for (const offer of offers) {
    await prisma.lendingOffer.upsert({
      where: { id: offer.id },
      update: {
        organizationId: organization.id,
        lenderMembershipId: offer.lenderMembershipId,
        amountMinorUnits: offer.amountMinorUnits,
        availableAmountMinorUnits: offer.availableAmountMinorUnits,
        minimumLoanAmountMinorUnits: offer.minimumLoanAmountMinorUnits,
        maximumLoanAmountMinorUnits: offer.maximumLoanAmountMinorUnits,
        currency: organization.currency,
        durationDays: offer.durationDays,
        feeRateBasisPoints: offer.feeRateBasisPoints,
        expiresAt: offer.expiresAt,
        status: offer.status,
      },
      create: {
        ...offer,
        organizationId: organization.id,
        currency: organization.currency,
      },
    });
  }

  const loans = [
    {
      id: "22000000-0000-4000-8000-000000000001",
      lenderMembershipId: membershipId("bob@acme.test"),
      borrowerMembershipId: membershipId("alice@acme.test"),
      principalAmountMinorUnits: 80_000n,
      feeAmountMinorUnits: 4_000n,
      durationDays: 20,
      feeRateBasisPoints: 500,
      outstandingPrincipalMinorUnits: 50_000n,
      status: "ACTIVE" as const,
      requestedAt: dateFromNow(now, -18),
      approvedAt: dateFromNow(now, -18),
      activatedAt: dateFromNow(now, -18),
      closedAt: null,
      startedAt: dateFromNow(now, -18),
      repaymentDueAt: dateFromNow(now, 2),
      createdAt: dateFromNow(now, -18),
      updatedAt: dateFromNow(now, 0, -2),
    },
    {
      id: "22000000-0000-4000-8000-000000000002",
      lenderMembershipId: membershipId("bob@acme.test"),
      borrowerMembershipId: membershipId("charlie@acme.test"),
      principalAmountMinorUnits: 120_000n,
      feeAmountMinorUnits: 6_000n,
      durationDays: 30,
      feeRateBasisPoints: 500,
      outstandingPrincipalMinorUnits: 90_000n,
      status: "OVERDUE" as const,
      requestedAt: dateFromNow(now, -34),
      approvedAt: dateFromNow(now, -34),
      activatedAt: dateFromNow(now, -34),
      closedAt: null,
      startedAt: dateFromNow(now, -34),
      repaymentDueAt: dateFromNow(now, -4),
      createdAt: dateFromNow(now, -34),
      updatedAt: dateFromNow(now, 0, -1),
    },
    {
      id: "22000000-0000-4000-8000-000000000003",
      lenderMembershipId: membershipId("alice@acme.test"),
      borrowerMembershipId: membershipId("bob@acme.test"),
      principalAmountMinorUnits: 40_000n,
      feeAmountMinorUnits: 2_000n,
      durationDays: 18,
      feeRateBasisPoints: 500,
      outstandingPrincipalMinorUnits: 0n,
      status: "REPAID" as const,
      requestedAt: dateFromNow(now, -28),
      approvedAt: dateFromNow(now, -28),
      activatedAt: dateFromNow(now, -28),
      closedAt: dateFromNow(now, -15),
      startedAt: dateFromNow(now, -28),
      repaymentDueAt: dateFromNow(now, -10),
      createdAt: dateFromNow(now, -28),
      updatedAt: dateFromNow(now, -1),
    },
    {
      id: "22000000-0000-4000-8000-000000000004",
      lenderMembershipId: membershipId("alice@acme.test"),
      borrowerMembershipId: membershipId("charlie@acme.test"),
      principalAmountMinorUnits: 60_000n,
      feeAmountMinorUnits: 3_000n,
      durationDays: 24,
      feeRateBasisPoints: 500,
      outstandingPrincipalMinorUnits: 60_000n,
      status: "ACTIVE" as const,
      requestedAt: dateFromNow(now, -3),
      approvedAt: dateFromNow(now, -3),
      activatedAt: dateFromNow(now, -3),
      closedAt: null,
      startedAt: dateFromNow(now, -3),
      repaymentDueAt: dateFromNow(now, 21),
      createdAt: dateFromNow(now, -3),
      updatedAt: dateFromNow(now, 0, -3),
    },
    {
      id: "22000000-0000-4000-8000-000000000005",
      lenderMembershipId: membershipId("bob@acme.test"),
      borrowerMembershipId: membershipId("charlie@acme.test"),
      principalAmountMinorUnits: 25_000n,
      feeAmountMinorUnits: 1_000n,
      durationDays: 14,
      feeRateBasisPoints: 400,
      outstandingPrincipalMinorUnits: 25_000n,
      status: "REQUESTED" as const,
      requestedAt: dateFromNow(now, -1),
      approvedAt: null,
      activatedAt: null,
      closedAt: null,
      startedAt: now,
      repaymentDueAt: dateFromNow(now, 14),
      createdAt: dateFromNow(now, -1),
      updatedAt: dateFromNow(now, -1),
    },
    {
      id: "22000000-0000-4000-8000-000000000006",
      lenderMembershipId: membershipId("bob@acme.test"),
      borrowerMembershipId: membershipId("alice@acme.test"),
      principalAmountMinorUnits: 50_000n,
      feeAmountMinorUnits: 2_500n,
      durationDays: 30,
      feeRateBasisPoints: 500,
      outstandingPrincipalMinorUnits: 50_000n,
      status: "APPROVED" as const,
      requestedAt: dateFromNow(now, -2),
      approvedAt: dateFromNow(now, -1),
      activatedAt: null,
      closedAt: null,
      startedAt: now,
      repaymentDueAt: dateFromNow(now, 30),
      createdAt: dateFromNow(now, -2),
      updatedAt: dateFromNow(now, -1),
    },
  ];

  for (const loan of loans) {
    await prisma.loan.upsert({
      where: { id: loan.id },
      update: {
        organizationId: organization.id,
        lenderMembershipId: loan.lenderMembershipId,
        borrowerMembershipId: loan.borrowerMembershipId,
        principalAmountMinorUnits: loan.principalAmountMinorUnits,
        feeAmountMinorUnits: loan.feeAmountMinorUnits,
        durationDays: loan.durationDays,
        feeRateBasisPoints: loan.feeRateBasisPoints,
        outstandingPrincipalMinorUnits: loan.outstandingPrincipalMinorUnits,
        currency: organization.currency,
        status: loan.status,
        requestedAt: loan.requestedAt,
        approvedAt: loan.approvedAt,
        activatedAt: loan.activatedAt,
        closedAt: loan.closedAt,
        startedAt: loan.startedAt,
        repaymentDueAt: loan.repaymentDueAt,
        createdAt: loan.createdAt,
        updatedAt: loan.updatedAt,
      },
      create: {
        ...loan,
        organizationId: organization.id,
        currency: organization.currency,
      },
    });
  }

  const repayments = [
    {
      id: "33000000-0000-4000-8000-000000000001",
      loanId: "22000000-0000-4000-8000-000000000001",
      amountMinorUnits: 14_000n,
      paidAt: dateFromNow(now, -10),
    },
    {
      id: "33000000-0000-4000-8000-000000000002",
      loanId: "22000000-0000-4000-8000-000000000001",
      amountMinorUnits: 20_000n,
      paidAt: dateFromNow(now, -4),
    },
    {
      id: "33000000-0000-4000-8000-000000000003",
      loanId: "22000000-0000-4000-8000-000000000002",
      amountMinorUnits: 36_000n,
      paidAt: dateFromNow(now, -15),
    },
    {
      id: "33000000-0000-4000-8000-000000000004",
      loanId: "22000000-0000-4000-8000-000000000003",
      amountMinorUnits: 42_000n,
      paidAt: dateFromNow(now, -15),
    },
  ];

  for (const repayment of repayments) {
    await prisma.loanRepayment.upsert({
      where: { id: repayment.id },
      update: {
        organizationId: organization.id,
        loanId: repayment.loanId,
        amountMinorUnits: repayment.amountMinorUnits,
        currency: organization.currency,
        paidAt: repayment.paidAt,
        completedAt: repayment.paidAt,
      },
      create: {
        ...repayment,
        organizationId: organization.id,
        currency: organization.currency,
        completedAt: repayment.paidAt,
      },
    });
  }

  const auditEvents = [
    {
      id: "44000000-0000-4000-8000-000000000001",
      loanId: "22000000-0000-4000-8000-000000000001",
      type: "LOAN_CREATED" as const,
      title: "Loan terms agreed",
      actorLabel: "Alice Carter and Bob Lee",
      occurredAt: dateFromNow(now, -18),
    },
    {
      id: "44000000-0000-4000-8000-000000000002",
      loanId: "22000000-0000-4000-8000-000000000001",
      type: "LOAN_ACTIVATED" as const,
      title: "Loan became active",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -18, 1),
    },
    {
      id: "44000000-0000-4000-8000-000000000003",
      loanId: "22000000-0000-4000-8000-000000000001",
      type: "REPAYMENT_RECORDED" as const,
      title: "First repayment recorded",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -10),
    },
    {
      id: "44000000-0000-4000-8000-000000000004",
      loanId: "22000000-0000-4000-8000-000000000001",
      type: "REPAYMENT_RECORDED" as const,
      title: "Second repayment recorded",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -4),
    },
    {
      id: "44000000-0000-4000-8000-000000000005",
      loanId: "22000000-0000-4000-8000-000000000002",
      type: "LOAN_CREATED" as const,
      title: "Loan terms agreed",
      actorLabel: "Charlie Rivera and Bob Lee",
      occurredAt: dateFromNow(now, -34),
    },
    {
      id: "44000000-0000-4000-8000-000000000006",
      loanId: "22000000-0000-4000-8000-000000000002",
      type: "REPAYMENT_RECORDED" as const,
      title: "Repayment recorded",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -15),
    },
    {
      id: "44000000-0000-4000-8000-000000000007",
      loanId: "22000000-0000-4000-8000-000000000002",
      type: "LOAN_OVERDUE" as const,
      title: "Repayment date passed",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -3),
    },
    {
      id: "44000000-0000-4000-8000-000000000008",
      loanId: "22000000-0000-4000-8000-000000000003",
      type: "LOAN_CREATED" as const,
      title: "Loan terms agreed",
      actorLabel: "Bob Lee and Alice Carter",
      occurredAt: dateFromNow(now, -28),
    },
    {
      id: "44000000-0000-4000-8000-000000000009",
      loanId: "22000000-0000-4000-8000-000000000003",
      type: "LOAN_REPAID" as const,
      title: "Loan repaid in full",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -15),
    },
    {
      id: "44000000-0000-4000-8000-000000000010",
      loanId: "22000000-0000-4000-8000-000000000004",
      type: "LOAN_CREATED" as const,
      title: "Loan terms agreed",
      actorLabel: "Charlie Rivera and Alice Carter",
      occurredAt: dateFromNow(now, -3),
    },
    {
      id: "44000000-0000-4000-8000-000000000011",
      loanId: "22000000-0000-4000-8000-000000000004",
      type: "LOAN_ACTIVATED" as const,
      title: "Loan became active",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -3, 1),
    },
    {
      id: "44000000-0000-4000-8000-000000000012",
      loanId: "22000000-0000-4000-8000-000000000005",
      actorMembershipId: membershipId("charlie@acme.test"),
      type: "LOAN_REQUESTED" as const,
      title: "Loan requested",
      actorLabel: "Charlie Rivera",
      occurredAt: dateFromNow(now, -1),
    },
    {
      id: "44000000-0000-4000-8000-000000000013",
      loanId: "22000000-0000-4000-8000-000000000006",
      actorMembershipId: membershipId("bob@acme.test"),
      type: "LOAN_APPROVED" as const,
      title: "Loan approved",
      actorLabel: "Bob Lee",
      occurredAt: dateFromNow(now, -1),
    },
  ];

  for (const event of auditEvents) {
    await prisma.auditEvent.upsert({
      where: { id: event.id },
      update: {
        organizationId: organization.id,
        loanId: event.loanId,
        type: event.type,
        title: event.title,
        actorMembershipId:
          "actorMembershipId" in event ? event.actorMembershipId : null,
        actorLabel: event.actorLabel,
        occurredAt: event.occurredAt,
      },
      create: {
        ...event,
        organizationId: organization.id,
      },
    });
  }
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("Failed to seed development data.", error);
    await prisma.$disconnect();
    process.exit(1);
  });
