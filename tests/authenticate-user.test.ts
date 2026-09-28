import { describe, expect, it, vi } from "vitest";

import {
  authenticateUser,
  type AuthenticationResult,
} from "@/modules/auth/application/authenticate-user";
import { InvalidCredentialsError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthRepository } from "@/modules/auth/application/ports/auth-repository";
import type { PasswordHasher } from "@/modules/auth/application/ports/password-hasher";
import type { SessionTokenService } from "@/modules/auth/application/ports/session-token-service";
import { ApplicationRole } from "@/modules/auth/domain/application-role";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function createDependencies(overrides?: {
  user?: Awaited<ReturnType<AuthRepository["findUserForAuthentication"]>>;
  passwordMatches?: boolean;
}) {
  const createSession = vi.fn<AuthRepository["createSession"]>();
  const authRepository: AuthRepository = {
    findUserForAuthentication: vi.fn(async () =>
      overrides && "user" in overrides
        ? (overrides.user ?? null)
        : {
            id: "user-1",
            email: "employee@demo.test",
            name: "Demo Employee",
            passwordHash: "stored-hash",
            memberships: [
              {
                organizationId: "organization-1",
                organizationName: "Demo Company",
                organizationSlug: "demo-company",
                role: ApplicationRole.EMPLOYEE,
              },
            ],
          },
    ),
    createSession,
    findActorBySessionTokenHash: vi.fn(async () => null),
    deleteSessionByTokenHash: vi.fn(async () => undefined),
  };
  const passwordHasher: PasswordHasher = {
    hash: vi.fn(async () => "stored-hash"),
    verify: vi.fn(async () => overrides?.passwordMatches ?? true),
  };
  const sessionTokenService: SessionTokenService = {
    generate: vi.fn(() => "raw-session-token"),
    hash: vi.fn(() => "hashed-session-token"),
  };

  return {
    dependencies: {
      authRepository,
      passwordHasher,
      sessionTokenService,
      now: () => NOW,
    },
    createSession,
  };
}

describe("authenticateUser", () => {
  it("creates an organization-scoped session for valid credentials", async () => {
    const { dependencies, createSession } = createDependencies();

    const result: AuthenticationResult = await authenticateUser(
      { email: "employee@demo.test", password: "Employee123!" },
      dependencies,
    );

    expect(result.actor).toMatchObject({
      userId: "user-1",
      organizationId: "organization-1",
      role: ApplicationRole.EMPLOYEE,
    });
    expect(result.sessionToken).toBe("raw-session-token");
    expect(createSession).toHaveBeenCalledWith({
      tokenHash: "hashed-session-token",
      userId: "user-1",
      organizationId: "organization-1",
      expiresAt: new Date("2026-01-08T00:00:00.000Z"),
    });
  });

  it("returns the same safe error for an unknown user or bad password", async () => {
    const missingUser = createDependencies({ user: null });
    const badPassword = createDependencies({ passwordMatches: false });

    await expect(
      authenticateUser(
        { email: "missing@demo.test", password: "wrong" },
        missingUser.dependencies,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      authenticateUser(
        { email: "employee@demo.test", password: "wrong" },
        badPassword.dependencies,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});
