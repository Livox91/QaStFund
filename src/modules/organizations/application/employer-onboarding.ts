import { OrganizationNotFoundError } from "@/modules/auth/application/errors/auth-errors";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { EmployerOnboardingRepository } from "@/modules/organizations/application/ports/employer-onboarding-repository";

export async function getEmployerOnboarding(
  actor: AuthenticatedActor | null,
  repository: EmployerOnboardingRepository,
  blockchainConfigured: boolean,
) {
  const admin = requireEmployerAdmin(actor);
  const snapshot = await repository.getSnapshot({
    organizationId: admin.organizationId,
    actorUserId: admin.userId,
  });
  if (!snapshot) throw new OrganizationNotFoundError();

  const checklist = {
    organizationProfile: snapshot.organization.name.trim().length >= 2,
    employerAdmin: snapshot.activeEmployerAdminCount > 0,
    employeeDirectory: snapshot.employeeCount > 0,
    lendingPolicy: snapshot.policy !== null,
    blockchainTestnet: blockchainConfigured,
    erpNext:
      !snapshot.organization.erpNextEnabled ||
      snapshot.erpNext?.connectionStatus === "connected",
  };
  return {
    ...snapshot,
    checklist,
    readyForPilot: Object.values(checklist).every(Boolean),
  };
}

export async function updateEmployerOrganizationName(
  actor: AuthenticatedActor | null,
  name: string,
  repository: EmployerOnboardingRepository,
) {
  const admin = requireEmployerAdmin(actor);
  const updated = await repository.updateOrganizationName({
    organizationId: admin.organizationId,
    actorUserId: admin.userId,
    name,
  });
  if (!updated) throw new OrganizationNotFoundError();
}

export async function setEmployerErpNextEnabled(
  actor: AuthenticatedActor | null,
  enabled: boolean,
  repository: EmployerOnboardingRepository,
) {
  const admin = requireEmployerAdmin(actor);
  const updated = await repository.setErpNextEnabled({
    organizationId: admin.organizationId,
    actorUserId: admin.userId,
    enabled,
  });
  if (!updated) throw new OrganizationNotFoundError();
}

export async function startInitialEmployeeSynchronization<T>(
  actor: AuthenticatedActor | null,
  repository: EmployerOnboardingRepository,
  synchronize: (actor: AuthenticatedActor) => Promise<T>,
): Promise<T> {
  const admin = requireEmployerAdmin(actor);
  const snapshot = await repository.getSnapshot({
    organizationId: admin.organizationId,
    actorUserId: admin.userId,
  });
  if (!snapshot) throw new OrganizationNotFoundError();
  if (!snapshot.organization.erpNextEnabled || !snapshot.erpNext) {
    throw new Error("ERP_NEXT_NOT_READY");
  }
  return synchronize(admin);
}
