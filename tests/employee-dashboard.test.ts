import { describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { getEmployeeDashboard } from "@/modules/employees/application/get-employee-dashboard";
import type {
  EmployeeDashboardRepository,
  EmployeeDashboardRepositoryResult,
} from "@/modules/employees/application/ports/employee-dashboard-repository";

const employee: AuthenticatedActor = {
  userId: "employee-a",
  email: "employee@organization-a.test",
  name: "Employee A",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYEE,
};

const repositoryResult: EmployeeDashboardRepositoryResult = {
  currency: "USD",
  availableBalanceMinorUnits: 50_000n,
  totalEarningsMinorUnits: 2_000n,
  currentLoans: [
    {
      id: "active-borrowing",
      counterpartyName: "Lender One",
      participation: "BORROWING",
      principalAmountMinorUnits: 80_000n,
      feeAmountMinorUnits: 4_000n,
      outstandingPrincipalMinorUnits: 50_000n,
      currency: "USD",
      status: "ACTIVE",
      repaymentDueAt: new Date("2026-10-01T00:00:00.000Z"),
      repayments: [
        { amountMinorUnits: 14_000n },
        { amountMinorUnits: 20_000n },
      ],
    },
    {
      id: "overdue-borrowing",
      counterpartyName: "Lender Two",
      participation: "BORROWING",
      principalAmountMinorUnits: 20_000n,
      feeAmountMinorUnits: 1_000n,
      outstandingPrincipalMinorUnits: 10_000n,
      currency: "USD",
      status: "OVERDUE",
      repaymentDueAt: new Date("2026-09-20T00:00:00.000Z"),
      repayments: [{ amountMinorUnits: 11_000n }],
    },
    {
      id: "active-lending",
      counterpartyName: "Borrower One",
      participation: "LENDING",
      principalAmountMinorUnits: 60_000n,
      feeAmountMinorUnits: 3_000n,
      outstandingPrincipalMinorUnits: 60_000n,
      currency: "USD",
      status: "ACTIVE",
      repaymentDueAt: new Date("2026-10-20T00:00:00.000Z"),
      repayments: [],
    },
  ],
  recentActivity: [
    {
      id: "event-1",
      title: "Repayment recorded",
      participation: "BORROWING",
      counterpartyName: "Lender One",
      occurredAt: new Date("2026-09-25T00:00:00.000Z"),
    },
  ],
  pendingTransactions: [],
};

function createRepository(
  result: EmployeeDashboardRepositoryResult | null = repositoryResult,
): EmployeeDashboardRepository {
  return {
    loadForEmployee: vi.fn(async () => result),
  };
}

describe("getEmployeeDashboard", () => {
  it("derives employee and tenant scope exclusively from the authenticated actor", async () => {
    const repository = createRepository();

    await getEmployeeDashboard(
      employee,
      repository,
      new Date("2026-09-29T00:00:00.000Z"),
    );

    expect(repository.loadForEmployee).toHaveBeenCalledWith({
      organizationId: "organization-a",
      userId: "employee-a",
      now: new Date("2026-09-29T00:00:00.000Z"),
    });
  });

  it("cannot be redirected to another employee through request input", async () => {
    const repository = createRepository();
    const organizationBEmployee = {
      ...employee,
      userId: "employee-b",
      organizationId: "organization-b",
      organizationName: "Organization B",
      organizationSlug: "organization-b",
    };

    await getEmployeeDashboard(
      organizationBEmployee,
      repository,
      new Date("2026-09-29T00:00:00.000Z"),
    );

    expect(repository.loadForEmployee).toHaveBeenCalledWith({
      organizationId: "organization-b",
      userId: "employee-b",
      now: new Date("2026-09-29T00:00:00.000Z"),
    });
  });

  it("derives dashboard metrics and repayment projections in integer minor units", async () => {
    const dashboard = await getEmployeeDashboard(
      employee,
      createRepository(),
      new Date("2026-09-29T00:00:00.000Z"),
    );

    expect(dashboard.metrics).toEqual({
      availableBalanceMinorUnits: 50_000n,
      amountLentMinorUnits: 60_000n,
      amountBorrowedMinorUnits: 60_000n,
      totalEarningsMinorUnits: 2_000n,
      nextPayment: {
        loanId: "active-borrowing",
        lenderName: "Lender One",
        amountMinorUnits: 50_000n,
        currency: "USD",
        dueAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    });
    expect(dashboard.activeBorrowing).toHaveLength(2);
    expect(dashboard.activeLending).toHaveLength(1);
    expect(dashboard.upcomingRepayments).toHaveLength(1);
    expect(dashboard.activeBorrowing[0]).toMatchObject({
      remainingAgreedAmountMinorUnits: 50_000n,
      progressBasisPoints: 4_047,
    });
  });

  it("surfaces authoritative pending transaction records without treating them as confirmed", async () => {
    const pending = {
      ...repositoryResult,
      pendingTransactions: [
        {
          id: "repayment:pending-a",
          kind: "repayment" as const,
          title: "Repayment awaiting confirmation",
          href: "/app/loans/loan-a",
          startedAt: new Date("2026-09-29T00:00:00.000Z"),
        },
      ],
    };
    const dashboard = await getEmployeeDashboard(
      employee,
      createRepository(pending),
    );
    expect(dashboard.pendingTransactions).toEqual([
      expect.objectContaining({
        id: "repayment:pending-a",
        status: "pending",
      }),
    ]);
  });

  it("rejects employer admins before querying employee financial data", async () => {
    const repository = createRepository();

    await expect(
      getEmployeeDashboard(
        { ...employee, role: ApplicationRole.EMPLOYER_ADMIN },
        repository,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.loadForEmployee).not.toHaveBeenCalled();
  });

  it("fails closed when the scoped membership is missing or inactive", async () => {
    await expect(
      getEmployeeDashboard(employee, createRepository(null)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
