import { describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { getEmployerLoanDetails } from "@/modules/loans/application/get-employer-loan-details";
import { listEmployerLoans } from "@/modules/loans/application/list-employer-loans";
import type {
  EmployerLoanDetailsRecord,
  EmployerLoanRepository,
} from "@/modules/loans/application/ports/employer-loan-repository";
import {
  calculateLoanFinancialProgress,
  EmployerLoanFilter,
} from "@/modules/loans/domain/employer-loan";
import {
  employerLoanFilterSchema,
  employerLoanIdSchema,
} from "@/modules/loans/schemas/employer-loan.schema";

const employerAdmin: AuthenticatedActor = {
  userId: "admin-a",
  email: "admin@organization-a.test",
  name: "Organization A Admin",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYER_ADMIN,
};

const loan: EmployerLoanDetailsRecord = {
  id: "20000000-0000-4000-8000-000000000001",
  borrowerName: "Borrower",
  lenderName: "Lender",
  principalAmountMinorUnits: 80_000n,
  feeAmountMinorUnits: 4_000n,
  currency: "USD",
  status: "ACTIVE",
  startedAt: new Date("2026-09-01T00:00:00.000Z"),
  repaymentDueAt: new Date("2026-10-01T00:00:00.000Z"),
  repayments: [
    {
      id: "repayment-1",
      amountMinorUnits: 14_000n,
      currency: "USD",
      paidAt: new Date("2026-09-10T00:00:00.000Z"),
    },
    {
      id: "repayment-2",
      amountMinorUnits: 20_000n,
      currency: "USD",
      paidAt: new Date("2026-09-20T00:00:00.000Z"),
    },
  ],
  auditEvents: [],
};

function createRepository(): EmployerLoanRepository {
  return {
    listForOrganization: vi.fn(async () => [loan]),
    findDetailsForOrganization: vi.fn(async () => loan),
  };
}

describe("employer loan financial progress", () => {
  it("uses integer minor units and basis points", () => {
    expect(
      calculateLoanFinancialProgress({
        principalAmountMinorUnits: 80_000n,
        feeAmountMinorUnits: 4_000n,
        repaymentAmountsMinorUnits: [14_000n, 20_000n],
      }),
    ).toEqual({
      totalAgreedAmountMinorUnits: 84_000n,
      repaidAmountMinorUnits: 34_000n,
      remainingAmountMinorUnits: 50_000n,
      progressBasisPoints: 4_047,
    });
  });

  it("caps display progress when recorded repayments exceed agreed terms", () => {
    expect(
      calculateLoanFinancialProgress({
        principalAmountMinorUnits: 100n,
        feeAmountMinorUnits: 10n,
        repaymentAmountsMinorUnits: [120n],
      }),
    ).toMatchObject({
      repaidAmountMinorUnits: 110n,
      remainingAmountMinorUnits: 0n,
      progressBasisPoints: 10_000,
    });
  });
});

describe("employer loan queries", () => {
  it("derives list scope and status from the authenticated employer", async () => {
    const repository = createRepository();

    await expect(
      listEmployerLoans(employerAdmin, EmployerLoanFilter.ACTIVE, repository),
    ).resolves.toHaveLength(1);

    expect(repository.listForOrganization).toHaveBeenCalledWith({
      organizationId: "organization-a",
      status: "ACTIVE",
    });
  });

  it("never accepts a caller-supplied organization for loan details", async () => {
    const repository = createRepository();

    await expect(
      getEmployerLoanDetails(employerAdmin, loan.id, repository),
    ).resolves.toMatchObject({
      id: loan.id,
      remainingAmountMinorUnits: 50_000n,
    });

    expect(repository.findDetailsForOrganization).toHaveBeenCalledWith({
      loanId: loan.id,
      organizationId: "organization-a",
    });
  });

  it("rejects employees before any loan query", async () => {
    const repository = createRepository();
    const employee = { ...employerAdmin, role: ApplicationRole.EMPLOYEE };

    await expect(
      listEmployerLoans(employee, EmployerLoanFilter.ALL, repository),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getEmployerLoanDetails(employee, loan.id, repository),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(repository.listForOrganization).not.toHaveBeenCalled();
    expect(repository.findDetailsForOrganization).not.toHaveBeenCalled();
  });
});

describe("employer loan request validation", () => {
  it("accepts supported filters and safely falls back to all", () => {
    expect(employerLoanFilterSchema.parse("overdue")).toBe("overdue");
    expect(employerLoanFilterSchema.parse("unknown")).toBe("all");
    expect(employerLoanFilterSchema.parse(undefined)).toBe("all");
  });

  it("requires a UUID-shaped loan identifier", () => {
    expect(employerLoanIdSchema.safeParse(loan.id).success).toBe(true);
    expect(employerLoanIdSchema.safeParse("not-a-loan-id").success).toBe(false);
  });
});
