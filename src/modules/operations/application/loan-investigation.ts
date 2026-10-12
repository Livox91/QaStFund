import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationError } from "@/shared/errors/application-error";

export type LoanOperationalTrace = Readonly<Record<string, unknown>>;

export interface LoanInvestigationRepository {
  findOperationalTrace(input: {
    organizationId: string;
    loanId: string;
  }): Promise<LoanOperationalTrace | null>;
}

export async function investigateLoanOperations(
  actor: AuthenticatedActor | null,
  loanId: string,
  repository: LoanInvestigationRepository,
) {
  const operator = requireEmployerAdmin(actor);
  const trace = await repository.findOperationalTrace({
    organizationId: operator.organizationId,
    loanId,
  });
  if (!trace) {
    throw new ApplicationError(
      "OPERATIONAL_TRACE_NOT_FOUND",
      "Operational trace not found.",
      404,
    );
  }
  return trace;
}
