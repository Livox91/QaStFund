import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { EmployerLoanRepository } from "@/modules/loans/application/ports/employer-loan-repository";
import {
  calculateLoanFinancialProgress,
  type EmployerLoanDetails,
} from "@/modules/loans/domain/employer-loan";

export async function getEmployerLoanDetails(
  actor: AuthenticatedActor | null,
  loanId: string,
  repository: EmployerLoanRepository,
): Promise<EmployerLoanDetails | null> {
  const employerAdmin = requireEmployerAdmin(actor);
  const loan = await repository.findDetailsForOrganization({
    organizationId: employerAdmin.organizationId,
    loanId,
  });

  if (!loan) return null;

  return {
    ...loan,
    ...calculateLoanFinancialProgress({
      principalAmountMinorUnits: loan.principalAmountMinorUnits,
      feeAmountMinorUnits: loan.feeAmountMinorUnits,
      repaymentAmountsMinorUnits: loan.repayments.map(
        (repayment) => repayment.amountMinorUnits,
      ),
    }),
  };
}
