import { describe, expect, it, vi } from "vitest";

import { getAuthenticatedActor } from "@/modules/auth/application/get-authenticated-actor";
import {
  ForbiddenError,
  UnauthenticatedError,
} from "@/modules/auth/application/errors/auth-errors";
import type { AuthRepository } from "@/modules/auth/application/ports/auth-repository";
import type { SessionTokenService } from "@/modules/auth/application/ports/session-token-service";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { toCurrentSession } from "@/modules/auth/domain/current-session";
import {
  getCurrentOrganization,
  listCurrentOrganizationMembers,
} from "@/modules/organizations/application/get-current-organization";
import type { OrganizationMembershipRepository } from "@/modules/organizations/application/ports/organization-membership-repository";
import { apiError } from "@/shared/api/responses";

const organization = {
  id: "organization-a",
  name: "Organization A",
  slug: "organization-a",
  currency: "USD",
} as const;

const employee: AuthenticatedActor = {
  userId: "employee-a",
  email: "employee@organization-a.test",
  name: "Employee A",
  organizationId: organization.id,
  organizationName: organization.name,
  organizationSlug: organization.slug,
  role: ApplicationRole.EMPLOYEE,
};

const admin: AuthenticatedActor = {
  ...employee,
  userId: "admin-a",
  email: "admin@organization-a.test",
  name: "Admin A",
  role: ApplicationRole.EMPLOYER_ADMIN,
};

function createRepository(): OrganizationMembershipRepository {
  return {
    findOrganizationById: vi.fn(async (organizationId) =>
      organizationId === organization.id ? organization : null,
    ),
    listMembers: vi.fn(async () => [
      {
        id: "membership-a",
        userId: employee.userId,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        employmentStatus: "ACTIVE" as const,
        isActive: true,
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]),
  };
}

describe("organization membership authorization", () => {
  it("returns 401 for an unauthenticated organization request", async () => {
    const error = await getCurrentOrganization(null, createRepository()).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(apiError(error).status).toBe(401);
  });

  it("allows an employee to access their own organization", async () => {
    const repository = createRepository();

    await expect(getCurrentOrganization(employee, repository)).resolves.toEqual(
      organization,
    );
    expect(repository.findOrganizationById).toHaveBeenCalledWith(
      "organization-a",
    );
  });

  it("allows an admin to access their own organization", async () => {
    const repository = createRepository();

    await expect(getCurrentOrganization(admin, repository)).resolves.toEqual(
      organization,
    );
  });

  it("derives member-list tenant scope from the authenticated admin", async () => {
    const repository = createRepository();

    await listCurrentOrganizationMembers(admin, repository);

    expect(repository.listMembers).toHaveBeenCalledWith("organization-a");
    expect(repository.listMembers).not.toHaveBeenCalledWith("organization-b");
  });

  it("returns 403 before data access when an employee lists members", async () => {
    const repository = createRepository();
    const error = await listCurrentOrganizationMembers(
      employee,
      repository,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(apiError(error).status).toBe(403);
    expect(repository.listMembers).not.toHaveBeenCalled();
  });
});

describe("current authenticated user", () => {
  it("returns the user, organization, and role resolved from the session", async () => {
    const authRepository = {
      findActorBySessionTokenHash: vi.fn(async () => employee),
    } as unknown as AuthRepository;
    const sessionTokenService = {
      hash: vi.fn(() => "hashed-token"),
    } as unknown as SessionTokenService;

    const actor = await getAuthenticatedActor("raw-token", {
      authRepository,
      sessionTokenService,
    });

    expect(authRepository.findActorBySessionTokenHash).toHaveBeenCalledWith(
      "hashed-token",
      expect.any(Date),
    );
    expect(toCurrentSession(actor!)).toEqual({
      user: {
        id: employee.userId,
        email: employee.email,
        name: employee.name,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      role: ApplicationRole.EMPLOYEE,
    });
    expect(toCurrentSession(actor!)).not.toHaveProperty("passwordHash");
  });
});
