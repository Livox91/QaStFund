import { describe, expect, it, vi } from "vitest";

import { RegistrationConflictError } from "@/modules/auth/application/errors/auth-errors";
import type { PasswordHasher } from "@/modules/auth/application/ports/password-hasher";
import type { RegistrationRepository } from "@/modules/auth/application/ports/auth-repository";
import type { SessionTokenService } from "@/modules/auth/application/ports/session-token-service";
import { registerOrganizationAdmin } from "@/modules/auth/application/register-organization-admin";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { registerSchema } from "@/modules/auth/schemas/register.schema";

const input = {
  name: "Acme Admin",
  email: "admin@acme.test",
  password: "AcmeAdmin123!",
  organizationName: "Acme Corp",
  organizationSlug: "acme-corp",
};

function createDependencies(result: "CREATED" | "CONFLICT" = "CREATED") {
  const passwordHasher: PasswordHasher = {
    hash: vi.fn(async () => "secure-password-hash"),
    verify: vi.fn(),
  };
  const registrationRepository: RegistrationRepository = {
    registerOrganizationAdmin: vi.fn(async () =>
      result === "CONFLICT"
        ? ({ kind: "CONFLICT" } as const)
        : {
            kind: "CREATED" as const,
            actor: {
              userId: "user-1",
              email: input.email,
              name: input.name,
              organizationId: "organization-1",
              organizationName: input.organizationName,
              organizationSlug: input.organizationSlug,
              role: ApplicationRole.EMPLOYER_ADMIN,
            },
          },
    ),
  };
  const sessionTokenService: SessionTokenService = {
    generate: vi.fn(() => "raw-token"),
    hash: vi.fn(() => "hashed-token"),
  };

  return { passwordHasher, registrationRepository, sessionTokenService };
}

describe("organization registration", () => {
  it("validates credentials and rejects caller-supplied tenancy or role", () => {
    expect(registerSchema.parse(input)).toEqual(input);
    expect(
      registerSchema.safeParse({ ...input, role: ApplicationRole.EMPLOYEE })
        .success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...input, organizationId: "foreign-org" })
        .success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...input, password: "weak" }).success,
    ).toBe(false);
  });

  it("hashes the password and atomically requests an admin membership session", async () => {
    const dependencies = createDependencies();
    const result = await registerOrganizationAdmin(input, {
      ...dependencies,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(dependencies.passwordHasher.hash).toHaveBeenCalledWith(
      input.password,
    );
    expect(
      dependencies.registrationRepository.registerOrganizationAdmin,
    ).toHaveBeenCalledWith({
      name: input.name,
      email: input.email,
      passwordHash: "secure-password-hash",
      organizationName: input.organizationName,
      organizationSlug: input.organizationSlug,
      sessionTokenHash: "hashed-token",
      sessionExpiresAt: new Date("2026-01-08T00:00:00.000Z"),
    });
    expect(result.actor.role).toBe(ApplicationRole.EMPLOYER_ADMIN);
    expect(result.sessionToken).toBe("raw-token");
  });

  it("returns a safe conflict without exposing which unique field exists", async () => {
    await expect(
      registerOrganizationAdmin(input, createDependencies("CONFLICT")),
    ).rejects.toMatchObject({
      constructor: RegistrationConflictError,
      code: "REGISTRATION_CONFLICT",
      statusCode: 409,
    });
  });
});
