import { describe, expect, it, vi } from "vitest";

import {
  requireAuthenticatedUser,
  requireEmployee,
  requireEmployerAdmin,
  requireOrganizationAccess,
} from "@/modules/auth/application/authorization";
import {
  ForbiddenError,
  OrganizationNotFoundError,
  UnauthenticatedError,
} from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";

const organizationAEmployee: AuthenticatedActor = {
  userId: "user-a",
  email: "employee@organization-a.test",
  name: "Organization A Employee",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYEE,
};

const organizationAAdmin: AuthenticatedActor = {
  ...organizationAEmployee,
  userId: "admin-a",
  email: "admin@organization-a.test",
  name: "Organization A Admin",
  role: ApplicationRole.EMPLOYER_ADMIN,
};

describe("authorization policies", () => {
  it("requires a server-resolved authenticated user", () => {
    expect(() => requireAuthenticatedUser(null)).toThrow(UnauthenticatedError);
    expect(requireAuthenticatedUser(organizationAEmployee)).toBe(
      organizationAEmployee,
    );
  });

  it("enforces employer and employee roles", () => {
    expect(requireEmployerAdmin(organizationAAdmin)).toBe(organizationAAdmin);
    expect(requireEmployee(organizationAEmployee)).toBe(organizationAEmployee);
    expect(() => requireEmployerAdmin(organizationAEmployee)).toThrow(
      ForbiddenError,
    );
    expect(() => requireEmployee(organizationAAdmin)).toThrow(ForbiddenError);
  });

  it("allows access to the actor's organization", () => {
    expect(
      requireOrganizationAccess(organizationAEmployee, "organization-a"),
    ).toBe(organizationAEmployee);
  });

  it("blocks Organization A from accessing Organization B before data access", () => {
    const organizationRepository = vi.fn(
      (input: { organizationId: string }) => ({
        id: "resource-from-organization-b",
        organizationId: input.organizationId,
      }),
    );

    const loadOrganizationResource = (
      actor: AuthenticatedActor,
      requestedOrganizationId: string,
    ) => {
      const authorizedActor = requireOrganizationAccess(
        actor,
        requestedOrganizationId,
      );

      return organizationRepository({
        organizationId: authorizedActor.organizationId,
      });
    };

    expect(() =>
      loadOrganizationResource(organizationAEmployee, "organization-b"),
    ).toThrow(OrganizationNotFoundError);
    expect(organizationRepository).not.toHaveBeenCalled();
  });

  it("does not reveal whether a foreign organization exists", () => {
    try {
      requireOrganizationAccess(organizationAAdmin, "organization-b");
      throw new Error("Expected organization access to be denied.");
    } catch (error) {
      expect(error).toBeInstanceOf(OrganizationNotFoundError);
      expect(error).toMatchObject({
        code: "ORGANIZATION_NOT_FOUND",
        statusCode: 404,
        message: "Organization was not found.",
      });
    }
  });
});
