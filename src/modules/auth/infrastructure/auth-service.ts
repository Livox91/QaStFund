import "server-only";

import { authenticateUser } from "@/modules/auth/application/authenticate-user";
import { getAuthenticatedActor } from "@/modules/auth/application/get-authenticated-actor";
import { registerOrganizationAdmin } from "@/modules/auth/application/register-organization-admin";
import { revokeSession } from "@/modules/auth/application/revoke-session";
import { prismaAuthRepository } from "@/modules/auth/infrastructure/prisma-auth-repository";
import { prismaRegistrationRepository } from "@/modules/auth/infrastructure/prisma-registration-repository";
import { scryptPasswordHasher } from "@/modules/auth/infrastructure/scrypt-password-hasher";
import { secureSessionTokenService } from "@/modules/auth/infrastructure/secure-session-token-service";
import { incrementOperationalCounter } from "@/infrastructure/observability/operational-signals";
import { InvalidCredentialsError } from "@/modules/auth/application/errors/auth-errors";

const authenticationDependencies = {
  authRepository: prismaAuthRepository,
  passwordHasher: scryptPasswordHasher,
  sessionTokenService: secureSessionTokenService,
};

const sessionDependencies = {
  authRepository: prismaAuthRepository,
  sessionTokenService: secureSessionTokenService,
};

export async function signInWithPassword(input: {
  email: string;
  password: string;
}) {
  try {
    return await authenticateUser(input, authenticationDependencies);
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      incrementOperationalCounter("authentication_failures_total");
    }
    throw error;
  }
}

export function registerOrganization(input: {
  name: string;
  email: string;
  password: string;
  organizationName: string;
  organizationSlug: string;
}) {
  return registerOrganizationAdmin(input, {
    passwordHasher: scryptPasswordHasher,
    registrationRepository: prismaRegistrationRepository,
    sessionTokenService: secureSessionTokenService,
  });
}

export function resolveAuthenticatedActor(sessionToken: string | undefined) {
  return getAuthenticatedActor(sessionToken, sessionDependencies);
}

export function signOutSession(sessionToken: string | undefined) {
  return revokeSession(sessionToken, sessionDependencies);
}
