import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "@/infrastructure/database/prisma";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import {
  getEmployeeOriginationDecisionForActor,
  getEmployerOriginationDecisionForActor,
  listEmployerOriginationDecisionsForActor,
  overrideOriginationDecisionForActor,
} from "@/modules/loan-decisions/application/origination-decisions";
import {
  evaluateAndPersistLoanOrigination,
  isOriginationAuthorized,
} from "@/modules/loan-decisions/infrastructure/prisma-origination-decision-repository";

const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const adminUserId = randomUUID();
const borrowerUserId = randomUUID();
const lenderUserId = randomUUID();
const adminMembershipId = randomUUID();
const borrowerMembershipId = randomUUID();
const lenderMembershipId = randomUUID();
const offerId = randomUUID();
const rejectedOfferId = randomUUID();
const loanId = randomUUID();
const rejectedBorrowerUserId = randomUUID();
const rejectedBorrowerMembershipId = randomUUID();
const rejectedLoanId = randomUUID();
const evaluatedAt = new Date("2026-10-11T13:30:00.000Z");

const admin = {
  userId: adminUserId,
  email: "admin@decision.test",
  name: "Decision Admin",
  organizationId,
  organizationName: "Decision Test",
  organizationSlug: `decision-${organizationId}`,
  role: ApplicationRole.EMPLOYER_ADMIN,
} as const;
const borrower = {
  ...admin,
  userId: borrowerUserId,
  email: "borrower@decision.test",
  name: "Decision Borrower",
  role: ApplicationRole.EMPLOYEE,
};

describe("origination decision persistence", () => {
  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        {
          id: organizationId,
          name: "Decision Test",
          slug: `decision-${organizationId}`,
        },
        {
          id: otherOrganizationId,
          name: "Other Decision Test",
          slug: `decision-${otherOrganizationId}`,
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: adminUserId,
          email: `admin-${adminUserId}@test.local`,
          name: "Decision Admin",
          passwordHash: "test-only",
        },
        {
          id: borrowerUserId,
          email: `borrower-${borrowerUserId}@test.local`,
          name: "Decision Borrower",
          passwordHash: "test-only",
        },
        {
          id: lenderUserId,
          email: `lender-${lenderUserId}@test.local`,
          name: "Decision Lender",
          passwordHash: "test-only",
        },
        {
          id: rejectedBorrowerUserId,
          email: `rejected-${rejectedBorrowerUserId}@test.local`,
          name: "Rejected Borrower",
          passwordHash: "test-only",
        },
      ],
    });
    await prisma.organizationMembership.createMany({
      data: [
        {
          id: adminMembershipId,
          organizationId,
          userId: adminUserId,
          role: "EMPLOYER_ADMIN",
        },
        {
          id: borrowerMembershipId,
          organizationId,
          userId: borrowerUserId,
          role: "EMPLOYEE",
        },
        {
          id: lenderMembershipId,
          organizationId,
          userId: lenderUserId,
          role: "EMPLOYEE",
        },
        {
          id: rejectedBorrowerMembershipId,
          organizationId,
          userId: rejectedBorrowerUserId,
          role: "EMPLOYEE",
        },
      ],
    });
    await prisma.organizationLendingPolicy.update({
      where: { organizationId },
      data: {
        maxLoanAmountMinorUnits: 20_000n,
        maxOutstandingDebtMinorUnits: 50_000n,
      },
    });
    await prisma.lendingOffer.create({
      data: {
        id: offerId,
        organizationId,
        lenderMembershipId,
        amountMinorUnits: 10_000n,
        availableAmountMinorUnits: 10_000n,
        minimumLoanAmountMinorUnits: 10_000n,
        maximumLoanAmountMinorUnits: 10_000n,
        currency: "USD",
        durationDays: 30,
        feeRateBasisPoints: 500,
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        status: "ACTIVE",
        fundingStatus: "FUNDED",
      },
    });
    await prisma.lendingOffer.create({
      data: {
        id: rejectedOfferId,
        organizationId,
        lenderMembershipId,
        amountMinorUnits: 10_000n,
        availableAmountMinorUnits: 10_000n,
        minimumLoanAmountMinorUnits: 10_000n,
        maximumLoanAmountMinorUnits: 10_000n,
        currency: "USD",
        durationDays: 30,
        feeRateBasisPoints: 500,
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        status: "ACTIVE",
        fundingStatus: "FUNDED",
      },
    });
    await prisma.loan.create({
      data: {
        id: loanId,
        organizationId,
        lenderMembershipId,
        borrowerMembershipId,
        lendingOfferId: rejectedOfferId,
        principalAmountMinorUnits: 10_000n,
        feeAmountMinorUnits: 500n,
        outstandingPrincipalMinorUnits: 10_000n,
        currency: "USD",
        durationDays: 30,
        feeRateBasisPoints: 500,
        status: "REQUESTED",
        requestedAt: evaluatedAt,
        repaymentDueAt: new Date("2026-11-10T00:00:00.000Z"),
      },
    });
    await prisma.loan.create({
      data: {
        id: rejectedLoanId,
        organizationId,
        lenderMembershipId,
        borrowerMembershipId: rejectedBorrowerMembershipId,
        lendingOfferId: offerId,
        principalAmountMinorUnits: 10_000n,
        feeAmountMinorUnits: 500n,
        outstandingPrincipalMinorUnits: 10_000n,
        currency: "USD",
        durationDays: 30,
        feeRateBasisPoints: 500,
        status: "REQUESTED",
        requestedAt: evaluatedAt,
        repaymentDueAt: new Date("2026-11-10T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrganizationId] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            adminUserId,
            borrowerUserId,
            lenderUserId,
            rejectedBorrowerUserId,
          ],
        },
      },
    });
  });

  it("persists one immutable review decision when income and tenure are unavailable", async () => {
    const first = await evaluateAndPersistLoanOrigination({
      organizationId,
      loanId,
      evaluatedAt,
    });
    const second = await evaluateAndPersistLoanOrigination({
      organizationId,
      loanId,
      evaluatedAt: new Date("2026-10-11T13:31:00.000Z"),
    });
    expect(first).toMatchObject({
      modelVersion: "loan-decision-rules-v1",
      idempotencyKey: `${loanId}:loan-decision-rules-v1`,
      status: "REVIEW_REQUIRED",
      score: null,
      reasonCodes: expect.arrayContaining([
        "INCOME_UNAVAILABLE",
        "EMPLOYMENT_TENURE_UNAVAILABLE",
      ]),
    });
    expect(second?.id).toBe(first?.id);
    expect(first?.inputSnapshot).toMatchObject({
      application: { dataComplete: true, policyVersion: 1 },
      affordability: {
        incomeVerifiedAt: null,
        incomeEvidenceFresh: false,
      },
    });
    expect(first?.affordabilitySnapshot).toMatchObject({
      maximumPermittedPrincipalMinorUnits: null,
    });
    await expect(
      prisma.loanOriginationDecision.count({ where: { loanId } }),
    ).resolves.toBe(1);
    expect(first && isOriginationAuthorized(first)).toBe(false);
    await expect(
      prisma.auditEvent.count({
        where: { loanId, type: "LOAN_ORIGINATION_DECISION_RECORDED" },
      }),
    ).resolves.toBe(1);
  });

  it("allows only an employer administrator to record one auditable override", async () => {
    const decision = await prisma.loanOriginationDecision.findFirstOrThrow({
      where: { loanId },
    });
    await expect(
      overrideOriginationDecisionForActor(borrower, {
        decisionId: decision.id,
        outcome: "APPROVED",
        rationale:
          "Verified supporting evidence was reviewed by an administrator.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

    const override = await overrideOriginationDecisionForActor(
      admin,
      {
        decisionId: decision.id,
        outcome: "APPROVED",
        rationale:
          "Verified supporting evidence was reviewed by an administrator.",
      },
      new Date("2026-10-11T13:32:00.000Z"),
    );
    const repeated = await overrideOriginationDecisionForActor(
      admin,
      {
        decisionId: decision.id,
        outcome: "REJECTED",
        rationale:
          "A conflicting repeated decision must not replace the original.",
      },
      new Date("2026-10-11T13:33:00.000Z"),
    );
    expect(override.outcome).toBe("APPROVED");
    expect(repeated.id).toBe(override.id);
    expect(repeated.outcome).toBe("APPROVED");
    expect(
      isOriginationAuthorized({
        status: decision.status,
        reasonCodes: decision.reasonCodes,
        override: { outcome: override.outcome },
      }),
    ).toBe(true);
    await expect(
      prisma.auditEvent.count({
        where: { loanId, type: "LOAN_ORIGINATION_DECISION_OVERRIDDEN" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.auditEvent.count({ where: { loanId, type: "LOAN_APPROVED" } }),
    ).resolves.toBe(1);
    await expect(
      prisma.loan.findUniqueOrThrow({ where: { id: loanId } }),
    ).resolves.toMatchObject({
      status: "APPROVED",
      approvedAt: new Date("2026-10-11T13:32:00.000Z"),
      activatedAt: null,
    });
  });

  it("enforces borrower and organization read scopes", async () => {
    await expect(
      getEmployeeOriginationDecisionForActor(borrower, loanId),
    ).resolves.toMatchObject({ loanId, status: "REVIEW_REQUIRED" });
    await expect(
      getEmployerOriginationDecisionForActor(
        { ...admin, organizationId: otherOrganizationId },
        (
          await prisma.loanOriginationDecision.findFirstOrThrow({
            where: { loanId },
          })
        ).id,
      ),
    ).rejects.toMatchObject({ code: "LOAN_DECISION_NOT_FOUND" });
    await expect(
      prisma.loan.findUniqueOrThrow({ where: { id: loanId } }),
    ).resolves.toMatchObject({
      status: "APPROVED",
      outstandingPrincipalMinorUnits: 10_000n,
    });
    await expect(
      prisma.ledgerTransaction.count({ where: { referenceId: loanId } }),
    ).resolves.toBe(0);
  });

  it("provides a tenant-scoped employer review queue without full snapshots", async () => {
    const queue = await listEmployerOriginationDecisionsForActor(admin);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      loanId,
      borrowerMembershipId,
      status: "REVIEW_REQUIRED",
      loan: {
        principalAmountMinorUnits: "10000",
        feeAmountMinorUnits: "500",
      },
      borrowerMembership: { user: { name: "Decision Borrower" } },
    });
    expect(queue[0]).not.toHaveProperty("inputSnapshot");
    expect(() => JSON.stringify(queue)).not.toThrow();
    await expect(
      listEmployerOriginationDecisionsForActor(admin, "REVIEW_REQUIRED"),
    ).resolves.toEqual([]);
    await expect(
      listEmployerOriginationDecisionsForActor({
        ...admin,
        organizationId: otherOrganizationId,
      }),
    ).resolves.toEqual([]);
    await expect(
      listEmployerOriginationDecisionsForActor(borrower),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("cancels only an unexecuted request when an administrator rejects it", async () => {
    const decision = await evaluateAndPersistLoanOrigination({
      organizationId,
      loanId: rejectedLoanId,
      evaluatedAt,
    });
    const result = await overrideOriginationDecisionForActor(
      admin,
      {
        decisionId: decision!.id,
        outcome: "REJECTED",
        rationale:
          "Required affordability evidence was reviewed and was not sufficient.",
      },
      new Date("2026-10-12T13:40:00.000Z"),
    );
    expect(result.outcome).toBe("REJECTED");
    await expect(
      prisma.loan.findUniqueOrThrow({ where: { id: rejectedLoanId } }),
    ).resolves.toMatchObject({
      status: "CANCELLED",
      closedAt: new Date("2026-10-12T13:40:00.000Z"),
    });
    await expect(
      prisma.ledgerTransaction.count({
        where: { referenceId: rejectedLoanId },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.auditEvent.count({
        where: { loanId: rejectedLoanId, type: "LOAN_CANCELLED" },
      }),
    ).resolves.toBe(1);
  });
});
