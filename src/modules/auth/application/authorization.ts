import {
  ForbiddenError,
  OrganizationNotFoundError,
  UnauthenticatedError,
} from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";

export function requireAuthenticatedUser(
  actor: AuthenticatedActor | null,
): AuthenticatedActor {
  if (!actor) {
    throw new UnauthenticatedError();
  }

  return actor;
}

export function requireEmployerAdmin(
  actor: AuthenticatedActor | null,
): AuthenticatedActor {
  const authenticatedActor = requireAuthenticatedUser(actor);

  if (authenticatedActor.role !== ApplicationRole.EMPLOYER_ADMIN) {
    throw new ForbiddenError();
  }

  return authenticatedActor;
}

export function requireEmployee(
  actor: AuthenticatedActor | null,
): AuthenticatedActor {
  const authenticatedActor = requireAuthenticatedUser(actor);

  if (authenticatedActor.role !== ApplicationRole.EMPLOYEE) {
    throw new ForbiddenError();
  }

  return authenticatedActor;
}

export function requireOrganizationAccess(
  actor: AuthenticatedActor | null,
  requestedOrganizationId: string,
): AuthenticatedActor {
  const authenticatedActor = requireAuthenticatedUser(actor);

  if (authenticatedActor.organizationId !== requestedOrganizationId) {
    throw new OrganizationNotFoundError();
  }

  return authenticatedActor;
}
