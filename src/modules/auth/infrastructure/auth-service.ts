import "server-only";

import { authenticateUser } from "@/modules/auth/application/authenticate-user";
import { getAuthenticatedActor } from "@/modules/auth/application/get-authenticated-actor";
import { revokeSession } from "@/modules/auth/application/revoke-session";
import { prismaAuthRepository } from "@/modules/auth/infrastructure/prisma-auth-repository";
import { scryptPasswordHasher } from "@/modules/auth/infrastructure/scrypt-password-hasher";
import { secureSessionTokenService } from "@/modules/auth/infrastructure/secure-session-token-service";

const authenticationDependencies = {
  authRepository: prismaAuthRepository,
  passwordHasher: scryptPasswordHasher,
  sessionTokenService: secureSessionTokenService,
};

const sessionDependencies = {
  authRepository: prismaAuthRepository,
  sessionTokenService: secureSessionTokenService,
};

export function signInWithPassword(input: { email: string; password: string }) {
  return authenticateUser(input, authenticationDependencies);
}

export function resolveAuthenticatedActor(sessionToken: string | undefined) {
  return getAuthenticatedActor(sessionToken, sessionDependencies);
}

export function signOutSession(sessionToken: string | undefined) {
  return revokeSession(sessionToken, sessionDependencies);
}
