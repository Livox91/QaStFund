import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/infrastructure/database/prisma";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import {
  authorizePayrollDeduction,
  createPayrollDeductionProposal,
  actOnDelinquencyCase,
  evaluateOverdueInstallments,
  generatePayrollProposalsForCurrentPeriod,
  listDelinquencyCases,
  listPayrollDeductions,
  reconcilePayrollDeduction,
  reviewPayrollDeduction,
  submitPayrollDeduction,
} from "@/modules/payroll-operations/index.server";

vi.mock("server-only", () => ({}));

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const adminUserId = randomUUID();
const borrowerUserId = randomUUID();
const lenderUserId = randomUUID();
const otherAdminUserId = randomUUID();
let borrowerMembershipId: string;
let lenderMembershipId: string;
let installmentId: string;
let loanId: string;

const admin = {
  userId: adminUserId,
  email: `${adminUserId}@example.test`,
  name: "Payroll Admin",
  organizationId,
  organizationName: "Payroll Test",
  organizationSlug: `payroll-${organizationId}`,
  role: ApplicationRole.EMPLOYER_ADMIN,
};
const borrower = {
  userId: borrowerUserId,
  email: `${borrowerUserId}@example.test`,
  name: "Borrower",
  organizationId,
  organizationName: "Payroll Test",
  organizationSlug: `payroll-${organizationId}`,
  role: ApplicationRole.EMPLOYEE,
};
const otherAdmin = {
  userId: otherAdminUserId,
  email: `${otherAdminUserId}@example.test`,
  name: "Other Admin",
  organizationId: otherOrganizationId,
  organizationName: "Other",
  organizationSlug: `other-${otherOrganizationId}`,
  role: ApplicationRole.EMPLOYER_ADMIN,
};

beforeAll(async () => {
  vi.stubEnv("EMAIL_DELIVERY_ENDPOINT", "https://mail.example.test/send");
  vi.stubEnv("EMAIL_DELIVERY_TOKEN", "test-token");
  vi.stubEnv("EMAIL_FROM", "QastFund <test@example.test>");
  vi.stubEnv("EMAIL_PROVIDER", "http");
  vi.stubEnv("APP_URL", "https://qastfund.example.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 202 })),
  );
  await prisma.organization.createMany({
    data: [
      {
        id: organizationId,
        name: "Payroll Test",
        slug: `payroll-${organizationId}`,
      },
      {
        id: otherOrganizationId,
        name: "Other",
        slug: `other-${otherOrganizationId}`,
      },
    ],
  });
  await prisma.user.createMany({
    data: [
      {
        id: adminUserId,
        email: admin.email,
        name: admin.name,
        passwordHash: "test",
      },
      {
        id: borrowerUserId,
        email: borrower.email,
        name: borrower.name,
        passwordHash: "test",
      },
      {
        id: lenderUserId,
        email: `${lenderUserId}@example.test`,
        name: "Lender",
        passwordHash: "test",
      },
      {
        id: otherAdminUserId,
        email: otherAdmin.email,
        name: otherAdmin.name,
        passwordHash: "test",
      },
    ],
  });
  const memberships = await Promise.all([
    prisma.organizationMembership.create({
      data: { organizationId, userId: adminUserId, role: "EMPLOYER_ADMIN" },
    }),
    prisma.organizationMembership.create({
      data: { organizationId, userId: borrowerUserId, role: "EMPLOYEE" },
    }),
    prisma.organizationMembership.create({
      data: { organizationId, userId: lenderUserId, role: "EMPLOYEE" },
    }),
    prisma.organizationMembership.create({
      data: {
        organizationId: otherOrganizationId,
        userId: otherAdminUserId,
        role: "EMPLOYER_ADMIN",
      },
    }),
  ]);
  borrowerMembershipId = memberships[1].id;
  lenderMembershipId = memberships[2].id;
  const integration = await prisma.employeeDirectoryIntegration.create({
    data: {
      organizationId,
      baseUrl: "https://erp.example.test",
      authMethod: "TOKEN",
      credentialReference: "test-reference",
      statusMapping: { active: "ACTIVE" },
    },
  });
  await prisma.employeeDirectoryMapping.create({
    data: {
      organizationId,
      integrationId: integration.id,
      externalEmployeeId: "EMP-TEST",
      fullName: "Borrower",
      email: borrower.email,
      externalStatus: "Active",
      normalizedStatus: "ACTIVE",
      matchStatus: "MATCHED",
      matchMethod: "EXPLICIT",
      matchedMembershipId: borrowerMembershipId,
      lastSynchronizedAt: new Date("2026-10-01T00:00:00.000Z"),
    },
  });
  const loan = await prisma.loan.create({
    data: {
      organizationId,
      lenderMembershipId,
      borrowerMembershipId,
      principalAmountMinorUnits: 1_000n,
      feeAmountMinorUnits: 0n,
      outstandingPrincipalMinorUnits: 1_000n,
      currency: "USD",
      durationDays: 30,
      feeRateBasisPoints: 0,
      status: "ACTIVE",
      requestedAt: new Date("2026-09-01T00:00:00.000Z"),
      approvedAt: new Date("2026-09-01T00:00:00.000Z"),
      activatedAt: new Date("2026-09-01T00:00:00.000Z"),
      startedAt: new Date("2026-09-01T00:00:00.000Z"),
      repaymentDueAt: new Date("2026-10-10T00:00:00.000Z"),
    },
  });
  loanId = loan.id;
  const plan = await prisma.loanRepaymentPlan.create({
    data: {
      organizationId,
      loanId,
      version: 1,
      status: "ACTIVE",
      termMonths: 1,
      installmentCount: 1,
      totalRepaymentMinorUnits: 1_000n,
      currency: "USD",
      borrowerConsentedAt: new Date("2026-09-01T00:00:00.000Z"),
      effectiveAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  });
  const installment = await prisma.loanInstallment.create({
    data: {
      organizationId,
      loanId,
      planId: plan.id,
      sequence: 1,
      amountMinorUnits: 1_000n,
      dueAt: new Date("2026-10-10T00:00:00.000Z"),
    },
  });
  installmentId = installment.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      "SET LOCAL app.allow_ledger_cleanup = 'on'",
    );
    await transaction.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrganizationId] } },
    });
  });
  await prisma.user.deleteMany({
    where: {
      id: { in: [adminUserId, borrowerUserId, lenderUserId, otherAdminUserId] },
    },
  });
  await prisma.$disconnect();
});

describe("payroll deductions and delinquency operations", () => {
  let proposalId: string;

  it("creates one mapped proposal on repeated payroll generation", async () => {
    const first = await generatePayrollProposalsForCurrentPeriod(
      new Date("2026-10-13T00:00:00.000Z"),
    );
    const second = await generatePayrollProposalsForCurrentPeriod(
      new Date("2026-10-13T00:00:00.000Z"),
    );
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    const proposals = await listPayrollDeductions(admin);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].employeeMapping.externalEmployeeId).toBe("EMP-TEST");
    proposalId = proposals[0].id;
  });

  it("requires employee consent and rejects cross-tenant authorization", async () => {
    await expect(
      reviewPayrollDeduction(admin, proposalId, "APPROVE", "Approved"),
    ).rejects.toMatchObject({ code: "EMPLOYEE_CONSENT_REQUIRED" });
    await expect(
      authorizePayrollDeduction(
        { ...borrower, organizationId: otherOrganizationId },
        proposalId,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await authorizePayrollDeduction(borrower, proposalId);
    await expect(
      reviewPayrollDeduction(
        borrower,
        proposalId,
        "APPROVE",
        "Employee privilege escalation attempt.",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reviewPayrollDeduction(otherAdmin, proposalId, "APPROVE", "Other tenant"),
    ).rejects.toMatchObject({ code: "PAYROLL_PROPOSAL_NOT_FOUND" });
  });

  it("approves safely and exposes the exact ERPNext write blocker", async () => {
    await reviewPayrollDeduction(
      admin,
      proposalId,
      "APPROVE",
      "Employee authorized this deduction.",
    );
    const result = await submitPayrollDeduction(admin, proposalId);
    expect(result).toMatchObject({
      status: "NOT_AVAILABLE",
      lastSyncErrorCode: "ERP_NEXT_PAYROLL_WRITE_NOT_CONFIGURED",
    });
  });

  it("reconciles the actual partial amount once and leaves the balance outstanding", async () => {
    await expect(
      reconcilePayrollDeduction(borrower, proposalId, {
        actualAmountMinorUnits: 250n,
        externalReference: "UNAUTHORIZED-RESULT",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const first = await reconcilePayrollDeduction(admin, proposalId, {
      actualAmountMinorUnits: 250n,
      externalReference: "PAYROLL-RESULT-1",
    });
    const second = await reconcilePayrollDeduction(admin, proposalId, {
      actualAmountMinorUnits: 250n,
      externalReference: "PAYROLL-RESULT-1",
    });
    expect(first.status).toBe("PARTIALLY_DEDUCTED");
    expect(second.repaymentId).toBe(first.repaymentId);
    expect(
      await prisma.loanRepayment.count({
        where: { repaymentRequestId: proposalId },
      }),
    ).toBe(1);
    expect(
      await prisma.repaymentAllocation.aggregate({
        where: { installmentId },
        _sum: { amountMinorUnits: true },
      }),
    ).toMatchObject({ _sum: { amountMinorUnits: 250n } });
  });

  it("detects partial overdue balances, avoids duplicate alerts, and isolates tenants", async () => {
    vi.mocked(fetch).mockClear();
    const now = new Date("2026-10-13T00:00:00.000Z");
    const first = await evaluateOverdueInstallments(now);
    const second = await evaluateOverdueInstallments(now);
    expect(first.opened).toBe(1);
    expect(second.opened).toBe(0);
    const cases = await listDelinquencyCases(admin);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      state: "PARTIALLY_PAID",
      amountPaidMinorUnits: 250n,
      outstandingMinorUnits: 750n,
    });
    expect(cases[0].notifications).toHaveLength(2);
    expect(
      cases[0].notifications.map((item) => item.recipientMembershipId),
    ).toEqual(expect.arrayContaining([borrowerMembershipId]));
    await expect(listDelinquencyCases(borrower)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await listDelinquencyCases(otherAdmin)).toHaveLength(0);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    const emailBody = String(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body,
    );
    expect(emailBody).not.toContain("test-token");
    expect(emailBody).not.toContain("salary");
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) =>
        String((init as RequestInit).body).includes(`/app/loans/${loanId}`),
      ),
    ).toBe(true);
  });

  it("follows configured notification timing and retries persisted failures", async () => {
    await evaluateOverdueInstallments(new Date("2026-10-20T00:00:00.000Z"));
    const [record] = await listDelinquencyCases(admin);
    expect(record.notifications.map((item) => item.thresholdKey)).toEqual(
      expect.arrayContaining(["FIRST_OVERDUE", "FOLLOW_UP"]),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await evaluateOverdueInstallments(new Date("2026-10-30T00:00:00.000Z"));
    let refreshed = (await listDelinquencyCases(admin))[0];
    expect(
      refreshed.notifications.find(
        (item) => item.thresholdKey === "ESCALATION",
      ),
    ).toMatchObject({
      deliveryStatus: "FAILED",
      lastFailureCode: "EMAIL_PROVIDER_UNAVAILABLE",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 202 })),
    );
    await expect(
      actOnDelinquencyCase(borrower, record.id, {
        action: "RETRY_NOTIFICATION",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await actOnDelinquencyCase(admin, record.id, {
      action: "RETRY_NOTIFICATION",
    });
    refreshed = (await listDelinquencyCases(admin))[0];
    expect(
      refreshed.notifications.find(
        (item) => item.thresholdKey === "ESCALATION",
      ),
    ).toMatchObject({ deliveryStatus: "SENT", deliveryAttempts: 2 });
  });

  it("clears the overdue case after a fully reconciled verified deduction", async () => {
    const proposal = await createPayrollDeductionProposal(admin, {
      installmentId,
      payrollPeriodStart: new Date("2026-09-15T00:00:00.000Z"),
      payrollPeriodEnd: new Date("2026-10-15T23:59:59.999Z"),
      proposedAmountMinorUnits: 750n,
      idempotencyKey: `remaining-${installmentId}`,
    });
    await authorizePayrollDeduction(borrower, proposal.id);
    await reviewPayrollDeduction(
      admin,
      proposal.id,
      "APPROVE",
      "Authorized remainder.",
    );
    const reconciled = await reconcilePayrollDeduction(admin, proposal.id, {
      actualAmountMinorUnits: 750n,
      externalReference: "PAYROLL-RESULT-2",
    });
    expect(reconciled.status).toBe("RECONCILED");
    await evaluateOverdueInstallments(new Date("2026-10-31T00:00:00.000Z"));
    expect((await listDelinquencyCases(admin))[0]).toMatchObject({
      status: "RESOLVED",
      state: "RESOLVED",
      outstandingMinorUnits: 0n,
    });
  });
});
