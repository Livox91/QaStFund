import { describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import {
  EmployeeLoanNotFoundError,
  InvalidRepaymentError,
  LoanNotRepayableError,
  InsufficientRepaymentBalanceError,
} from "@/modules/loans/application/errors/repay-loan-errors";
import { getEmployeeLoanDetails } from "@/modules/loans/application/get-employee-loan-details";
import type { EmployeeLoanRepository } from "@/modules/loans/application/ports/employee-loan-repository";
import { repayLoan } from "@/modules/loans/application/repay-loan";
import {
  calculatePrincipalReduction,
  toEmployeeBorrowedLoanDetails,
  type EmployeeBorrowedLoanRecord,
  type RecordedLoanRepayment,
} from "@/modules/loans/domain/employee-loan";
import { repayLoanSchema } from "@/modules/loans/schemas/repay-loan.schema";

const now = new Date("2026-09-29T12:00:00.000Z");
const employee: AuthenticatedActor = {
  userId: "employee-a",
  email: "employee@organization-a.test",
  name: "Employee A",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYEE,
};
const loan: EmployeeBorrowedLoanRecord = {
  id: "20000000-0000-4000-8000-000000000001",
  lenderName: "Lender A",
  principalAmountMinorUnits: 80_000n,
  feeAmountMinorUnits: 4_000n,
  outstandingPrincipalMinorUnits: 50_000n,
  currency: "USD",
  durationDays: 30,
  feeRateBasisPoints: 500,
  status: "ACTIVE",
  startedAt: new Date("2026-09-01T12:00:00.000Z"),
  repaymentDueAt: new Date("2026-10-01T12:00:00.000Z"),
  repayments: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      amountMinorUnits: 34_000n,
      currency: "USD",
      status: "COMPLETED",
      createdAt: new Date("2026-09-20T12:00:00.000Z"),
      completedAt: new Date("2026-09-20T12:00:00.000Z"),
      paidAt: new Date("2026-09-20T12:00:00.000Z"),
    },
  ],
};
const command = {
  loanId: loan.id,
  amountMinorUnits: 10_000n,
  requestId: "50000000-0000-4000-8000-000000000001",
} as const;
const repayment: RecordedLoanRepayment = {
  id: "30000000-0000-4000-8000-000000000002",
  loanId: loan.id,
  amountMinorUnits: command.amountMinorUnits,
  currency: "USD",
  paidAt: now,
  completedAt: now,
  loanStatus: "ACTIVE",
};

function createRepository(): EmployeeLoanRepository {
  return {
    findBorrowedLoan: vi.fn(async () => loan),
    repayBorrowedLoan: vi.fn(async () => ({
      kind: "RECORDED" as const,
      repayment,
    })),
  };
}

describe("manual repayment domain rules", () => {
  it("derives remaining agreed amount from immutable terms and history", () => {
    expect(toEmployeeBorrowedLoanDetails(loan)).toMatchObject({
      totalAgreedAmountMinorUnits: 84_000n,
      repaidAmountMinorUnits: 34_000n,
      remainingAmountMinorUnits: 50_000n,
      progressBasisPoints: 4_047,
      canRepay: true,
    });
  });

  it("applies the agreed fee before reducing outstanding principal", () => {
    expect(
      calculatePrincipalReduction({
        feeAmountMinorUnits: 4_000n,
        previouslyRepaidMinorUnits: 0n,
        repaymentAmountMinorUnits: 3_000n,
        outstandingPrincipalMinorUnits: 80_000n,
      }),
    ).toBe(0n);
    expect(
      calculatePrincipalReduction({
        feeAmountMinorUnits: 4_000n,
        previouslyRepaidMinorUnits: 3_000n,
        repaymentAmountMinorUnits: 11_000n,
        outstandingPrincipalMinorUnits: 80_000n,
      }),
    ).toBe(10_000n);
  });

  it("parses repayment money without floating-point arithmetic", () => {
    expect(
      repayLoanSchema.parse({
        loanId: loan.id,
        amount: "100.01",
        requestId: command.requestId,
      }),
    ).toEqual({
      loanId: loan.id,
      amount: 10_001n,
      requestId: command.requestId,
    });
  });
});

describe("manual repayment application boundary", () => {
  it("derives borrower and tenant scope from the authenticated actor", async () => {
    const repository = createRepository();

    await expect(
      repayLoan(employee, command, repository, now),
    ).resolves.toEqual(repayment);
    expect(repository.repayBorrowedLoan).toHaveBeenCalledWith({
      organizationId: "organization-a",
      userId: "employee-a",
      command,
      now,
    });
  });

  it("scopes employee loan details to the authenticated borrower", async () => {
    const repository = createRepository();

    await getEmployeeLoanDetails(employee, loan.id, repository);
    expect(repository.findBorrowedLoan).toHaveBeenCalledWith({
      organizationId: "organization-a",
      userId: "employee-a",
      loanId: loan.id,
    });
  });

  it("returns the original repayment for an idempotent retry", async () => {
    const repository = createRepository();
    vi.mocked(repository.repayBorrowedLoan).mockResolvedValue({
      kind: "ALREADY_RECORDED",
      repayment,
    });

    await expect(
      repayLoan(employee, command, repository, now),
    ).resolves.toEqual(repayment);
  });

  it.each([
    ["LOAN_NOT_FOUND", EmployeeLoanNotFoundError],
    ["LOAN_NOT_REPAYABLE", LoanNotRepayableError],
    ["INSUFFICIENT_BALANCE", InsufficientRepaymentBalanceError],
  ] as const)(
    "maps %s to a safe application error",
    async (kind, ErrorType) => {
      const repository = createRepository();
      vi.mocked(repository.repayBorrowedLoan).mockResolvedValue({ kind });

      await expect(
        repayLoan(employee, command, repository, now),
      ).rejects.toBeInstanceOf(ErrorType);
    },
  );

  it("reports the authoritative remaining balance for overpayment", async () => {
    const repository = createRepository();
    vi.mocked(repository.repayBorrowedLoan).mockResolvedValue({
      kind: "AMOUNT_EXCEEDS_REMAINING",
      remainingAmountMinorUnits: 3_150n,
      currency: "USD",
    });

    await expect(repayLoan(employee, command, repository, now)).rejects.toThrow(
      "31.50 USD",
    );
  });

  it.each([0n, -1n])("rejects non-positive repayment %s", async (amount) => {
    const repository = createRepository();

    await expect(
      repayLoan(
        employee,
        { ...command, amountMinorUnits: amount },
        repository,
        now,
      ),
    ).rejects.toBeInstanceOf(InvalidRepaymentError);
    expect(repository.repayBorrowedLoan).not.toHaveBeenCalled();
  });

  it("rejects employer admins before repository access", async () => {
    const repository = createRepository();
    const employer = { ...employee, role: ApplicationRole.EMPLOYER_ADMIN };

    await expect(
      repayLoan(employer, command, repository, now),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.repayBorrowedLoan).not.toHaveBeenCalled();
  });
});
