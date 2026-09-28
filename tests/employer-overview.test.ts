import { describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import {
  describeLoanAttention,
  getEmployerOverview,
} from "@/modules/organizations/application/get-employer-overview";
import type { EmployerOverviewRepository } from "@/modules/organizations/application/ports/employer-overview-repository";
import { EmployerOverviewLoanStatus } from "@/modules/organizations/domain/employer-overview";

const employerAdmin: AuthenticatedActor = {
  userId: "admin-a",
  email: "admin@organization-a.test",
  name: "Organization A Admin",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYER_ADMIN,
};

const emptyOverview = {
  currency: "USD",
  metrics: {
    totalEmployees: 0,
    employeesCurrentlyLending: 0,
    employeesCurrentlyBorrowing: 0,
    availableLiquidityMinorUnits: 0n,
    outstandingPrincipalMinorUnits: 0n,
    repaymentsDue: 0,
    overdueLoans: 0,
  },
  recentLoanActivity: [],
  loansRequiringAttention: [],
};

describe("getEmployerOverview", () => {
  it("derives the tenant exclusively from the authenticated employer", async () => {
    const loadForOrganization = vi.fn(async () => emptyOverview);
    const repository: EmployerOverviewRepository = { loadForOrganization };
    const now = new Date("2026-09-29T00:00:00.000Z");

    await expect(
      getEmployerOverview(employerAdmin, repository, now),
    ).resolves.toMatchObject({ currency: "USD", generatedAt: now });

    expect(loadForOrganization).toHaveBeenCalledWith({
      organizationId: "organization-a",
      now,
      dueWindowEndsAt: new Date("2026-10-06T00:00:00.000Z"),
      attentionWindowEndsAt: new Date("2026-10-02T00:00:00.000Z"),
    });
  });

  it("rejects employees before querying overview data", async () => {
    const loadForOrganization = vi.fn(async () => emptyOverview);
    const repository: EmployerOverviewRepository = { loadForOrganization };

    await expect(
      getEmployerOverview(
        { ...employerAdmin, role: ApplicationRole.EMPLOYEE },
        repository,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(loadForOrganization).not.toHaveBeenCalled();
  });
});

describe("describeLoanAttention", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");

  it("describes overdue and upcoming repayment dates deterministically", () => {
    expect(
      describeLoanAttention(
        {
          status: EmployerOverviewLoanStatus.OVERDUE,
          repaymentDueAt: new Date("2026-09-27T12:00:00.000Z"),
        },
        now,
      ),
    ).toEqual({ kind: "OVERDUE", label: "Overdue by 2 days" });

    expect(
      describeLoanAttention(
        {
          status: EmployerOverviewLoanStatus.ACTIVE,
          repaymentDueAt: new Date("2026-09-30T12:00:00.000Z"),
        },
        now,
      ),
    ).toEqual({ kind: "DUE_SOON", label: "Due in 1 day" });
  });
});
