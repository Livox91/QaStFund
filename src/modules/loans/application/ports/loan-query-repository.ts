import type { ApplicationRole } from "@/modules/auth/domain/application-role";
import type { LoanView } from "@/modules/loans/domain/loan-query";

export interface LoanQueryRepository {
  listBorrowed(input: {
    organizationId: string;
    userId: string;
  }): Promise<ReadonlyArray<LoanView> | null>;

  listFunded(input: {
    organizationId: string;
    userId: string;
  }): Promise<ReadonlyArray<LoanView> | null>;

  findAccessible(input: {
    organizationId: string;
    userId: string;
    role: ApplicationRole;
    loanId: string;
  }): Promise<LoanView | null>;
}
