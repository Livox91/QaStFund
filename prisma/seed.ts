import "dotenv/config";

import { scryptPasswordHasher } from "../src/modules/auth/infrastructure/scrypt-password-hasher";
import { prisma } from "../src/infrastructure/database/prisma";

const DEMO_ORGANIZATION = {
  name: "Demo Company",
  slug: "demo-company",
  currency: "USD",
};

const DEMO_USERS = [
  {
    email: "admin@demo.test",
    name: "Demo Employer Admin",
    password: "Employer123!",
    role: "EMPLOYER_ADMIN" as const,
  },
  {
    email: "employee@demo.test",
    name: "Demo Employee",
    password: "Employee123!",
    role: "EMPLOYEE" as const,
  },
  {
    email: "jordan@demo.test",
    name: "Jordan Lee",
    password: "Employee123!",
    role: "EMPLOYEE" as const,
  },
  {
    email: "sam@demo.test",
    name: "Sam Rivera",
    password: "Employee123!",
    role: "EMPLOYEE" as const,
  },
  {
    email: "taylor@demo.test",
    name: "Taylor Chen",
    password: "Employee123!",
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
    { email: "employee@demo.test", amountMinorUnits: 500_000n },
    { email: "jordan@demo.test", amountMinorUnits: 1_000_000n },
    { email: "sam@demo.test", amountMinorUnits: 250_000n },
    { email: "taylor@demo.test", amountMinorUnits: 750_000n },
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

  const offers = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      lenderMembershipId: membershipId("jordan@demo.test"),
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
      id: "10000000-0000-4000-8000-000000000002",
      lenderMembershipId: membershipId("taylor@demo.test"),
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
      id: "10000000-0000-4000-8000-000000000003",
      lenderMembershipId: membershipId("employee@demo.test"),
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
      id: "20000000-0000-4000-8000-000000000001",
      lenderMembershipId: membershipId("jordan@demo.test"),
      borrowerMembershipId: membershipId("employee@demo.test"),
      principalAmountMinorUnits: 80_000n,
      feeAmountMinorUnits: 4_000n,
      outstandingPrincipalMinorUnits: 50_000n,
      status: "ACTIVE" as const,
      startedAt: dateFromNow(now, -18),
      repaymentDueAt: dateFromNow(now, 2),
      createdAt: dateFromNow(now, -18),
      updatedAt: dateFromNow(now, 0, -2),
    },
    {
      id: "20000000-0000-4000-8000-000000000002",
      lenderMembershipId: membershipId("taylor@demo.test"),
      borrowerMembershipId: membershipId("sam@demo.test"),
      principalAmountMinorUnits: 120_000n,
      feeAmountMinorUnits: 6_000n,
      outstandingPrincipalMinorUnits: 90_000n,
      status: "OVERDUE" as const,
      startedAt: dateFromNow(now, -34),
      repaymentDueAt: dateFromNow(now, -4),
      createdAt: dateFromNow(now, -34),
      updatedAt: dateFromNow(now, 0, -1),
    },
    {
      id: "20000000-0000-4000-8000-000000000003",
      lenderMembershipId: membershipId("employee@demo.test"),
      borrowerMembershipId: membershipId("taylor@demo.test"),
      principalAmountMinorUnits: 40_000n,
      feeAmountMinorUnits: 2_000n,
      outstandingPrincipalMinorUnits: 0n,
      status: "REPAID" as const,
      startedAt: dateFromNow(now, -28),
      repaymentDueAt: dateFromNow(now, -10),
      createdAt: dateFromNow(now, -28),
      updatedAt: dateFromNow(now, -1),
    },
    {
      id: "20000000-0000-4000-8000-000000000004",
      lenderMembershipId: membershipId("employee@demo.test"),
      borrowerMembershipId: membershipId("sam@demo.test"),
      principalAmountMinorUnits: 60_000n,
      feeAmountMinorUnits: 3_000n,
      outstandingPrincipalMinorUnits: 60_000n,
      status: "ACTIVE" as const,
      startedAt: dateFromNow(now, -3),
      repaymentDueAt: dateFromNow(now, 21),
      createdAt: dateFromNow(now, -3),
      updatedAt: dateFromNow(now, 0, -3),
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
        outstandingPrincipalMinorUnits: loan.outstandingPrincipalMinorUnits,
        currency: organization.currency,
        status: loan.status,
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
      id: "30000000-0000-4000-8000-000000000001",
      loanId: "20000000-0000-4000-8000-000000000001",
      amountMinorUnits: 14_000n,
      paidAt: dateFromNow(now, -10),
    },
    {
      id: "30000000-0000-4000-8000-000000000002",
      loanId: "20000000-0000-4000-8000-000000000001",
      amountMinorUnits: 20_000n,
      paidAt: dateFromNow(now, -4),
    },
    {
      id: "30000000-0000-4000-8000-000000000003",
      loanId: "20000000-0000-4000-8000-000000000002",
      amountMinorUnits: 36_000n,
      paidAt: dateFromNow(now, -15),
    },
    {
      id: "30000000-0000-4000-8000-000000000004",
      loanId: "20000000-0000-4000-8000-000000000003",
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
      },
      create: {
        ...repayment,
        organizationId: organization.id,
        currency: organization.currency,
      },
    });
  }

  const auditEvents = [
    {
      id: "40000000-0000-4000-8000-000000000001",
      loanId: "20000000-0000-4000-8000-000000000001",
      type: "LOAN_CREATED" as const,
      title: "Loan terms agreed",
      actorLabel: "Demo Employee and Jordan Lee",
      occurredAt: dateFromNow(now, -18),
    },
    {
      id: "40000000-0000-4000-8000-000000000002",
      loanId: "20000000-0000-4000-8000-000000000001",
      type: "LOAN_ACTIVATED" as const,
      title: "Loan became active",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -18, 1),
    },
    {
      id: "40000000-0000-4000-8000-000000000003",
      loanId: "20000000-0000-4000-8000-000000000001",
      type: "REPAYMENT_RECORDED" as const,
      title: "First repayment recorded",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -10),
    },
    {
      id: "40000000-0000-4000-8000-000000000004",
      loanId: "20000000-0000-4000-8000-000000000001",
      type: "REPAYMENT_RECORDED" as const,
      title: "Second repayment recorded",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -4),
    },
    {
      id: "40000000-0000-4000-8000-000000000005",
      loanId: "20000000-0000-4000-8000-000000000002",
      type: "LOAN_CREATED" as const,
      title: "Loan terms agreed",
      actorLabel: "Sam Rivera and Taylor Chen",
      occurredAt: dateFromNow(now, -34),
    },
    {
      id: "40000000-0000-4000-8000-000000000006",
      loanId: "20000000-0000-4000-8000-000000000002",
      type: "REPAYMENT_RECORDED" as const,
      title: "Repayment recorded",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -15),
    },
    {
      id: "40000000-0000-4000-8000-000000000007",
      loanId: "20000000-0000-4000-8000-000000000002",
      type: "LOAN_OVERDUE" as const,
      title: "Repayment date passed",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -3),
    },
    {
      id: "40000000-0000-4000-8000-000000000008",
      loanId: "20000000-0000-4000-8000-000000000003",
      type: "LOAN_CREATED" as const,
      title: "Loan terms agreed",
      actorLabel: "Taylor Chen and Demo Employee",
      occurredAt: dateFromNow(now, -28),
    },
    {
      id: "40000000-0000-4000-8000-000000000009",
      loanId: "20000000-0000-4000-8000-000000000003",
      type: "LOAN_REPAID" as const,
      title: "Loan repaid in full",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -15),
    },
    {
      id: "40000000-0000-4000-8000-000000000010",
      loanId: "20000000-0000-4000-8000-000000000004",
      type: "LOAN_CREATED" as const,
      title: "Loan terms agreed",
      actorLabel: "Sam Rivera and Demo Employee",
      occurredAt: dateFromNow(now, -3),
    },
    {
      id: "40000000-0000-4000-8000-000000000011",
      loanId: "20000000-0000-4000-8000-000000000004",
      type: "LOAN_ACTIVATED" as const,
      title: "Loan became active",
      actorLabel: "System",
      occurredAt: dateFromNow(now, -3, 1),
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
    console.error("Failed to seed demo authentication data.", error);
    await prisma.$disconnect();
    process.exit(1);
  });
