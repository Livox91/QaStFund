import type { EmployeeLoanParticipation } from "@/modules/employees/domain/employee-dashboard";
import type { LoanStatus } from "@/modules/loans";
import type { LoanDecisionClassification } from "@/modules/loan-decisions/domain/loan-decision";

export type EmployeeDashboardLoanRecord = Readonly<{
  id: string;
  counterpartyName: string;
  participation: EmployeeLoanParticipation;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  outstandingPrincipalMinorUnits: bigint;
  currency: string;
  status: LoanStatus;
  riskClassification?: LoanDecisionClassification | null;
  repaymentDueAt: Date;
  repayments: ReadonlyArray<Readonly<{ amountMinorUnits: bigint }>>;
}>;

export type EmployeeDashboardActivityRecord = Readonly<{
  id: string;
  title: string;
  participation: EmployeeLoanParticipation;
  counterpartyName: string;
  occurredAt: Date;
}>;

export type EmployeeDashboardRepositoryResult = Readonly<{
  currency: string;
  availableBalanceMinorUnits: bigint;
  totalEarningsMinorUnits: bigint;
  currentLoans: ReadonlyArray<EmployeeDashboardLoanRecord>;
  recentActivity: ReadonlyArray<EmployeeDashboardActivityRecord>;
}>;

export interface EmployeeDashboardRepository {
  loadForEmployee(input: {
    organizationId: string;
    userId: string;
    now: Date;
  }): Promise<EmployeeDashboardRepositoryResult | null>;
}
