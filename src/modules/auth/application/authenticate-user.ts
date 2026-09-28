import {
  AccountMembershipRequiredError,
  InvalidCredentialsError,
} from "@/modules/auth/application/errors/auth-errors";
import type { AuthRepository } from "@/modules/auth/application/ports/auth-repository";
import type { PasswordHasher } from "@/modules/auth/application/ports/password-hasher";
import type { SessionTokenService } from "@/modules/auth/application/ports/session-token-service";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { SESSION_DURATION_MS } from "@/modules/auth/domain/session";

const DUMMY_PASSWORD_HASH =
  "scrypt-v1$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

type AuthenticateUserDependencies = Readonly<{
  authRepository: AuthRepository;
  passwordHasher: PasswordHasher;
  sessionTokenService: SessionTokenService;
  now?: () => Date;
}>;

type AuthenticateUserInput = Readonly<{
  email: string;
  password: string;
}>;

export type AuthenticationResult = Readonly<{
  actor: AuthenticatedActor;
  sessionToken: string;
  expiresAt: Date;
}>;

export async function authenticateUser(
  input: AuthenticateUserInput,
  dependencies: AuthenticateUserDependencies,
): Promise<AuthenticationResult> {
  const user = await dependencies.authRepository.findUserForAuthentication(
    input.email,
  );
  const passwordMatches = await dependencies.passwordHasher.verify(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordMatches) {
    throw new InvalidCredentialsError();
  }

  if (user.memberships.length !== 1) {
    throw new AccountMembershipRequiredError();
  }

  const membership = user.memberships[0];
  const now = dependencies.now?.() ?? new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  const sessionToken = dependencies.sessionTokenService.generate();

  await dependencies.authRepository.createSession({
    tokenHash: dependencies.sessionTokenService.hash(sessionToken),
    userId: user.id,
    organizationId: membership.organizationId,
    expiresAt,
  });

  return {
    sessionToken,
    expiresAt,
    actor: {
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
      organizationSlug: membership.organizationSlug,
      role: membership.role,
    },
  };
}
