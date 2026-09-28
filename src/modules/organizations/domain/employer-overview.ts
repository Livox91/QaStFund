export const EmployerOverviewLoanStatus = {
  REQUESTED: "REQUESTED",
  APPROVED: "APPROVED",
  ACTIVE: "ACTIVE",
  REPAID: "REPAID",
  OVERDUE: "OVERDUE",
  DEFAULTED: "DEFAULTED",
  CANCELLED: "CANCELLED",
} as const;

export type EmployerOverviewLoanStatus =
  (typeof EmployerOverviewLoanStatus)[keyof typeof EmployerOverviewLoanStatus];

export type EmployerOverviewMetrics = Readonly<{
  totalEmployees: number;
  employeesCurrentlyLending: number;
  employeesCurrentlyBorrowing: number;
  availableLiquidityMinorUnits: bigint;
  outstandingPrincipalMinorUnits: bigint;
  repaymentsDue: number;
  overdueLoans: number;
}>;

export type EmployerOverviewLoan = Readonly<{
  id: string;
  borrowerName: string;
  lenderName: string;
  principalAmountMinorUnits: bigint;
  outstandingPrincipalMinorUnits: bigint;
  currency: string;
  status: EmployerOverviewLoanStatus;
  repaymentDueAt: Date;
  updatedAt: Date;
}>;

export type LoanAttention = Readonly<{
  kind: "OVERDUE" | "DUE_SOON";
  label: string;
}>;

export type EmployerOverviewAttentionLoan = EmployerOverviewLoan &
  Readonly<{ attention: LoanAttention }>;

export type EmployerOverview = Readonly<{
  currency: string;
  metrics: EmployerOverviewMetrics;
  recentLoanActivity: ReadonlyArray<EmployerOverviewLoan>;
  loansRequiringAttention: ReadonlyArray<EmployerOverviewAttentionLoan>;
  generatedAt: Date;
}>;
