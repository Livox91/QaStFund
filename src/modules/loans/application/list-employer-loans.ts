import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { EmployerLoanRepository } from "@/modules/loans/application/ports/employer-loan-repository";
import {
  calculateLoanFinancialProgress,
  EmployerLoanFilter,
  type EmployerLoanFilter as EmployerLoanFilterType,
  type EmployerLoanListItem,
  type EmployerLoanStatus,
} from "@/modules/loans/domain/employer-loan";

function toLoanStatus(
  filter: EmployerLoanFilterType,
): EmployerLoanStatus | undefined {
  if (filter === EmployerLoanFilter.ALL) return undefined;
  return filter.toUpperCase() as EmployerLoanStatus;
}

export async function listEmployerLoans(
  actor: AuthenticatedActor | null,
  filter: EmployerLoanFilterType,
  repository: EmployerLoanRepository,
): Promise<ReadonlyArray<EmployerLoanListItem>> {
  const employerAdmin = requireEmployerAdmin(actor);
  const loans = await repository.listForOrganization({
    organizationId: employerAdmin.organizationId,
    status: toLoanStatus(filter),
  });

  return loans.map((loan) => ({
    ...loan,
    ...calculateLoanFinancialProgress({
      principalAmountMinorUnits: loan.principalAmountMinorUnits,
      feeAmountMinorUnits: loan.feeAmountMinorUnits,
      repaymentAmountsMinorUnits: loan.repayments.map(
        (repayment) => repayment.amountMinorUnits,
      ),
    }),
  }));
}
