import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { LoanLifecycleRepository } from "@/modules/loans/application/ports/loan-lifecycle-repository";

export async function markOverdueLoans(
  actor: AuthenticatedActor | null,
  repository: LoanLifecycleRepository,
  now = new Date(),
): Promise<number> {
  const employerAdmin = requireEmployerAdmin(actor);
  return repository.markOverdue({
    organizationId: employerAdmin.organizationId,
    actorUserId: employerAdmin.userId,
    now,
  });
}
