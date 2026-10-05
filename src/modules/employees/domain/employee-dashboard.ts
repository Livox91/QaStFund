import type { LoanStatus } from "@/modules/loans";
import type { LoanDecisionClassification } from "@/modules/loan-decisions/domain/loan-decision";

export type EmployeeLoanParticipation = "BORROWING" | "LENDING";

export type EmployeeDashboardLoan = Readonly<{
  id: string;
  counterpartyName: string;
  participation: EmployeeLoanParticipation;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  totalAgreedAmountMinorUnits: bigint;
  repaidAmountMinorUnits: bigint;
  outstandingPrincipalMinorUnits: bigint;
  remainingAgreedAmountMinorUnits: bigint;
  progressBasisPoints: number;
  currency: string;
  status: LoanStatus;
  riskClassification?: LoanDecisionClassification | null;
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

export type EmployeePendingTransaction = Readonly<{
  id: string;
  kind: "offer_funding" | "loan_acceptance" | "repayment";
  status: "pending";
  title: string;
  href: string;
  startedAt: Date;
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
  pendingTransactions: ReadonlyArray<EmployeePendingTransaction>;
  generatedAt: Date;
}>;
