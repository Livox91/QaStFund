import {
  requireAuthenticatedUser,
  requireEmployerAdmin,
} from "@/modules/auth/application/authorization";
import { OrganizationNotFoundError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { OrganizationMembershipRepository } from "@/modules/organizations/application/ports/organization-membership-repository";

export async function getCurrentOrganization(
  actor: AuthenticatedActor | null,
  repository: OrganizationMembershipRepository,
) {
  const authenticatedActor = requireAuthenticatedUser(actor);
  const organization = await repository.findOrganizationById(
    authenticatedActor.organizationId,
  );

  if (!organization) throw new OrganizationNotFoundError();

  return organization;
}

export async function listCurrentOrganizationMembers(
  actor: AuthenticatedActor | null,
  repository: OrganizationMembershipRepository,
) {
  const employerAdmin = requireEmployerAdmin(actor);
  return repository.listMembers(employerAdmin.organizationId);
}
