import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { EmployerActionTargetNotFoundError } from "@/modules/employer-actions/application/errors";
import type { EmployerActionRepository } from "@/modules/employer-actions/application/ports/employer-action-repository";

export async function listEmployerActions(
  actor: AuthenticatedActor | null,
  loanId: string,
  repository: EmployerActionRepository,
) {
  const employer = requireEmployerAdmin(actor);
  const attempts = await repository.listForLoan({
    organizationId: employer.organizationId,
    loanId,
    requestedByUserId: employer.userId,
  });
  if (!attempts) throw new EmployerActionTargetNotFoundError();
  return attempts;
}
