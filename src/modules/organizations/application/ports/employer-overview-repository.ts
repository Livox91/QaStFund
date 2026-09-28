import type {
  EmployerOverviewLoan,
  EmployerOverviewMetrics,
} from "@/modules/organizations/domain/employer-overview";

export type EmployerOverviewRepositoryResult = Readonly<{
  currency: string;
  metrics: EmployerOverviewMetrics;
  recentLoanActivity: ReadonlyArray<EmployerOverviewLoan>;
  loansRequiringAttention: ReadonlyArray<EmployerOverviewLoan>;
}>;

export interface EmployerOverviewRepository {
  loadForOrganization(input: {
    attentionWindowEndsAt: Date;
    dueWindowEndsAt: Date;
    now: Date;
    organizationId: string;
  }): Promise<EmployerOverviewRepositoryResult>;
}
