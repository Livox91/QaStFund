import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { LoanNotFoundError } from "@/modules/loans/application/errors/borrow-loan-errors";
import type { LoanQueryRepository } from "@/modules/loans/application/ports/loan-query-repository";
import {
  getAccessibleLoan,
  listBorrowedLoans,
  listFundedLoans,
} from "@/modules/loans/application/query-loans";
import type { LoanView } from "@/modules/loans/domain/loan-query";

const employee: AuthenticatedActor = {
  userId: "employee-a",
  email: "employee@organization-a.test",
  name: "Employee A",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYEE,
};
const loan: LoanView = {
  id: "20000000-0000-4000-8000-000000000001",
  offerId: "10000000-0000-4000-8000-000000000001",
  principalAmountMinorUnits: 5_000n,
  interestAmountMinorUnits: 150n,
  repaymentAmountMinorUnits: 5_150n,
  totalRepaidMinorUnits: 0n,
  remainingBalanceMinorUnits: 5_150n,
  currency: "USD",
  termDays: 30,
  interestRateBasisPoints: 300,
  status: "ACTIVE",
  createdAt: new Date("2026-09-29T12:00:00.000Z"),
  activatedAt: new Date("2026-09-29T12:00:00.000Z"),
  dueAt: new Date("2026-10-29T12:00:00.000Z"),
  repaidAt: null,
  lender: { id: "lender-a", name: "Lender A" },
  borrower: { id: employee.userId, name: employee.name },
  repayments: [],
};

function repository(): LoanQueryRepository {
  return {
    listBorrowed: vi.fn(async () => [loan]),
    listFunded: vi.fn(async () => [loan]),
    findAccessible: vi.fn(async () => loan),
  };
}

describe("organization-scoped loan queries", () => {
  it("lists borrower and lender loans using identity-derived scope", async () => {
    const repo = repository();

    await expect(listBorrowedLoans(employee, repo)).resolves.toEqual([loan]);
    await expect(listFundedLoans(employee, repo)).resolves.toEqual([loan]);
    const scope = {
      organizationId: employee.organizationId,
      userId: employee.userId,
    };
    expect(repo.listBorrowed).toHaveBeenCalledWith(scope);
    expect(repo.listFunded).toHaveBeenCalledWith(scope);
  });

  it("allows participant and employer-admin lookups within their organization", async () => {
    const repo = repository();
    const admin = { ...employee, role: ApplicationRole.EMPLOYER_ADMIN };

    await getAccessibleLoan(employee, loan.id, repo);
    await getAccessibleLoan(admin, loan.id, repo);
    expect(repo.findAccessible).toHaveBeenNthCalledWith(1, {
      organizationId: employee.organizationId,
      userId: employee.userId,
      role: ApplicationRole.EMPLOYEE,
      loanId: loan.id,
    });
    expect(repo.findAccessible).toHaveBeenNthCalledWith(2, {
      organizationId: admin.organizationId,
      userId: admin.userId,
      role: ApplicationRole.EMPLOYER_ADMIN,
      loanId: loan.id,
    });
  });

  it("returns 404 for an unrelated or cross-organization loan", async () => {
    const repo = repository();
    vi.mocked(repo.findAccessible).mockResolvedValue(null);

    await expect(
      getAccessibleLoan(employee, loan.id, repo),
    ).rejects.toBeInstanceOf(LoanNotFoundError);
  });
});
