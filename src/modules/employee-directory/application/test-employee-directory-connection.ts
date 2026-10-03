import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { EmployeeDirectoryRepository } from "@/modules/employee-directory/application/ports/employee-directory-repository";
import type { EmployeeDirectoryAdapterFactory } from "@/modules/employee-directory/application/synchronize-employees";
import type { Clock } from "@/shared/time/clock";

export async function testEmployeeDirectoryConnection(
  actor: AuthenticatedActor | null,
  repository: EmployeeDirectoryRepository,
  createAdapter: EmployeeDirectoryAdapterFactory,
  clock: Clock,
) {
  const employer = requireEmployerAdmin(actor);
  const integration = await repository.getIntegration(employer.organizationId);
  if (!integration) throw new Error("DIRECTORY_NOT_CONFIGURED");
  const result = await createAdapter(integration).testConnection();
  await repository.recordConnectionResult({
    organizationId: employer.organizationId,
    ok: result.ok,
    code: result.messageCode,
    testedAt: clock.now(),
  });
  return result;
}
