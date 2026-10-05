import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type {
  EmployeeDashboardLoanRecord,
  EmployeeDashboardRepository,
} from "@/modules/employees/application/ports/employee-dashboard-repository";
import type {
  EmployeeDashboard,
  EmployeeDashboardLoan,
} from "@/modules/employees/domain/employee-dashboard";
import { calculateLoanFinancialProgress } from "@/modules/loans";

function toDashboardLoan(
  loan: EmployeeDashboardLoanRecord,
): EmployeeDashboardLoan {
  const progress = calculateLoanFinancialProgress({
    principalAmountMinorUnits: loan.principalAmountMinorUnits,
    feeAmountMinorUnits: loan.feeAmountMinorUnits,
    repaymentAmountsMinorUnits: loan.repayments.map(
      (repayment) => repayment.amountMinorUnits,
    ),
  });

  return {
    id: loan.id,
    counterpartyName: loan.counterpartyName,
    participation: loan.participation,
    principalAmountMinorUnits: loan.principalAmountMinorUnits,
    feeAmountMinorUnits: loan.feeAmountMinorUnits,
    totalAgreedAmountMinorUnits: progress.totalAgreedAmountMinorUnits,
    repaidAmountMinorUnits: progress.repaidAmountMinorUnits,
    outstandingPrincipalMinorUnits: loan.outstandingPrincipalMinorUnits,
    remainingAgreedAmountMinorUnits: progress.remainingAmountMinorUnits,
    progressBasisPoints: progress.progressBasisPoints,
    currency: loan.currency,
    status: loan.status,
    riskClassification: loan.riskClassification,
    repaymentDueAt: loan.repaymentDueAt,
  };
}

function sumOutstandingPrincipal(
  loans: ReadonlyArray<EmployeeDashboardLoan>,
): bigint {
  return loans.reduce(
    (total, loan) => total + loan.outstandingPrincipalMinorUnits,
    0n,
  );
}

export async function getEmployeeDashboard(
  actor: AuthenticatedActor | null,
  repository: EmployeeDashboardRepository,
  now = new Date(),
): Promise<EmployeeDashboard> {
  const employee = requireEmployee(actor);
  const result = await repository.loadForEmployee({
    organizationId: employee.organizationId,
    userId: employee.userId,
    now,
  });

  // A stale or inactive membership must fail closed even if an actor was
  // resolved earlier in the request lifecycle.
  if (!result) throw new ForbiddenError();

  const currentLoans = result.currentLoans.map(toDashboardLoan);
  const activeBorrowing = currentLoans.filter(
    (loan) => loan.participation === "BORROWING",
  );
  const activeLending = currentLoans.filter(
    (loan) => loan.participation === "LENDING",
  );
  const upcomingRepayments = activeBorrowing
    .filter(
      (loan) =>
        loan.status === "ACTIVE" &&
        loan.repaymentDueAt.getTime() >= now.getTime(),
    )
    .sort(
      (left, right) =>
        left.repaymentDueAt.getTime() - right.repaymentDueAt.getTime(),
    )
    .map((loan) => ({
      loanId: loan.id,
      lenderName: loan.counterpartyName,
      amountMinorUnits: loan.remainingAgreedAmountMinorUnits,
      currency: loan.currency,
      dueAt: loan.repaymentDueAt,
    }));

  return {
    currency: result.currency,
    metrics: {
      availableBalanceMinorUnits: result.availableBalanceMinorUnits,
      amountLentMinorUnits: sumOutstandingPrincipal(activeLending),
      amountBorrowedMinorUnits: sumOutstandingPrincipal(activeBorrowing),
      totalEarningsMinorUnits: result.totalEarningsMinorUnits,
      nextPayment: upcomingRepayments[0] ?? null,
    },
    activeBorrowing,
    activeLending,
    upcomingRepayments,
    recentActivity: result.recentActivity,
    pendingTransactions: result.pendingTransactions.map((transaction) => ({
      ...transaction,
      status: "pending" as const,
    })),
    generatedAt: now,
  };
}
