import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(employee)/app/loans/[loanId]/repayment-form", () => ({
  RepaymentForm: () => <button type="button">Repay $105</button>,
}));

import type { EmployeeDashboardLoan } from "@/modules/employees/domain/employee-dashboard";
import { EmployeeLoanList } from "@/modules/employees/ui/employee-loan-list";
import type { EmployeeBorrowedLoanDetails } from "@/modules/loans/domain/employee-loan";
import { EmployeeLoanDetails } from "@/modules/loans/ui/employee-loan-details";

const dueAt = new Date("2026-10-29T12:00:00.000Z");
const baseLoan: EmployeeBorrowedLoanDetails = {
  id: "20000000-0000-4000-8000-000000000001",
  lenderName: "Alice",
  principalAmountMinorUnits: 10_000n,
  feeAmountMinorUnits: 500n,
  outstandingPrincipalMinorUnits: 10_000n,
  repaymentBaseUnits: 105_000_000n,
  currency: "USD",
  durationDays: 30,
  feeRateBasisPoints: 500,
  status: "ACTIVE",
  startedAt: new Date("2026-09-29T12:00:00.000Z"),
  repaymentDueAt: dueAt,
  repayments: [],
  totalAgreedAmountMinorUnits: 10_500n,
  repaidAmountMinorUnits: 0n,
  remainingAmountMinorUnits: 10_500n,
  progressBasisPoints: 0,
  canRepay: true,
};

describe("on-chain repayment UI", () => {
  it("does not present an active loan as repaid before confirmation", () => {
    const markup = renderToStaticMarkup(
      <EmployeeLoanDetails loan={baseLoan} repaymentRecorded={false} />,
    );

    expect(markup).toContain("Active Loan");
    expect(markup).toContain("Repay $105");
    expect(markup).not.toContain("Repayment confirmed");
  });

  it("removes Bob's repayment action after confirmation", () => {
    const repaidLoan: EmployeeBorrowedLoanDetails = {
      ...baseLoan,
      status: "REPAID",
      outstandingPrincipalMinorUnits: 0n,
      repayments: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          amountMinorUnits: 10_500n,
          currency: "USD",
          status: "COMPLETED",
          createdAt: dueAt,
          completedAt: dueAt,
          paidAt: dueAt,
        },
      ],
      repaidAmountMinorUnits: 10_500n,
      remainingAmountMinorUnits: 0n,
      progressBasisPoints: 10_000,
      canRepay: false,
    };
    const markup = renderToStaticMarkup(
      <EmployeeLoanDetails loan={repaidLoan} repaymentRecorded />,
    );

    expect(markup).toContain("Loan Repaid ✓");
    expect(markup).toContain("Repayment confirmed");
    expect(markup).not.toContain("Repay $105");
  });

  it("shows Alice the received amount and earned interest", () => {
    const loan: EmployeeDashboardLoan = {
      id: baseLoan.id,
      counterpartyName: "Bob",
      participation: "LENDING",
      principalAmountMinorUnits: 10_000n,
      feeAmountMinorUnits: 500n,
      totalAgreedAmountMinorUnits: 10_500n,
      repaidAmountMinorUnits: 10_500n,
      outstandingPrincipalMinorUnits: 0n,
      remainingAgreedAmountMinorUnits: 0n,
      progressBasisPoints: 10_000,
      currency: "USD",
      status: "REPAID",
      repaymentDueAt: dueAt,
    };
    const markup = renderToStaticMarkup(
      <EmployeeLoanList emptyDescription="" emptyTitle="" loans={[loan]} />,
    );

    expect(markup).toContain("To Bob");
    expect(markup).toContain("Received");
    expect(markup).toContain("$105.00");
    expect(markup).toContain("Interest earned");
    expect(markup).toContain("$5.00");
  });

  it("shows Alice an overdue state without claiming repayment", () => {
    const loan: EmployeeDashboardLoan = {
      id: baseLoan.id,
      counterpartyName: "Bob",
      participation: "LENDING",
      principalAmountMinorUnits: 10_000n,
      feeAmountMinorUnits: 500n,
      totalAgreedAmountMinorUnits: 10_500n,
      repaidAmountMinorUnits: 0n,
      outstandingPrincipalMinorUnits: 10_000n,
      remainingAgreedAmountMinorUnits: 10_500n,
      progressBasisPoints: 0,
      currency: "USD",
      status: "ACTIVE",
      riskClassification: "overdue",
      repaymentDueAt: dueAt,
    };
    const markup = renderToStaticMarkup(
      <EmployeeLoanList emptyDescription="" emptyTitle="" loans={[loan]} />,
    );

    expect(markup).toContain("Overdue");
    expect(markup).toContain("Expected repayment");
    expect(markup).not.toContain("Received");
  });
});
