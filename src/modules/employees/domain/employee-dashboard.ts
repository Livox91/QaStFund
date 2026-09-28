import type { LoanStatus } from "@/modules/loans";

export type EmployeeLoanParticipation = "BORROWING" | "LENDING";

export type EmployeeDashboardLoan = Readonly<{
  id: string;
  counterpartyName: string;
  participation: EmployeeLoanParticipation;
  principalAmountMinorUnits: bigint;
  outstandingPrincipalMinorUnits: bigint;
  remainingAgreedAmountMinorUnits: bigint;
  progressBasisPoints: number;
  currency: string;
  status: LoanStatus;
  repaymentDueAt: Date;
}>;

export type EmployeeUpcomingRepayment = Readonly<{
  loanId: string;
  lenderName: string;
  amountMinorUnits: bigint;
  currency: string;
  dueAt: Date;
}>;

export type EmployeeDashboardActivity = Readonly<{
  id: string;
  title: string;
  participation: EmployeeLoanParticipation;
  counterpartyName: string;
  occurredAt: Date;
}>;

export type EmployeeDashboardMetrics = Readonly<{
  availableBalanceMinorUnits: bigint;
  amountLentMinorUnits: bigint;
  amountBorrowedMinorUnits: bigint;
  totalEarningsMinorUnits: bigint;
  nextPayment: EmployeeUpcomingRepayment | null;
}>;

export type EmployeeDashboard = Readonly<{
  currency: string;
  metrics: EmployeeDashboardMetrics;
  activeBorrowing: ReadonlyArray<EmployeeDashboardLoan>;
  activeLending: ReadonlyArray<EmployeeDashboardLoan>;
  upcomingRepayments: ReadonlyArray<EmployeeUpcomingRepayment>;
  recentActivity: ReadonlyArray<EmployeeDashboardActivity>;
  generatedAt: Date;
}>;
