import { RegistrationConflictError } from "@/modules/auth/application/errors/auth-errors";
import type { PasswordHasher } from "@/modules/auth/application/ports/password-hasher";
import type { RegistrationRepository } from "@/modules/auth/application/ports/auth-repository";
import type { SessionTokenService } from "@/modules/auth/application/ports/session-token-service";
import type { AuthenticationResult } from "@/modules/auth/application/authenticate-user";
import { SESSION_DURATION_MS } from "@/modules/auth/domain/session";

export type RegisterOrganizationAdminInput = Readonly<{
  name: string;
  email: string;
  password: string;
  organizationName: string;
  organizationSlug: string;
}>;

type RegisterOrganizationAdminDependencies = Readonly<{
  passwordHasher: PasswordHasher;
  registrationRepository: RegistrationRepository;
  sessionTokenService: SessionTokenService;
  now?: () => Date;
}>;

export async function registerOrganizationAdmin(
  input: RegisterOrganizationAdminInput,
  dependencies: RegisterOrganizationAdminDependencies,
): Promise<AuthenticationResult> {
  const now = dependencies.now?.() ?? new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  const sessionToken = dependencies.sessionTokenService.generate();
  const passwordHash = await dependencies.passwordHasher.hash(input.password);
  const result =
    await dependencies.registrationRepository.registerOrganizationAdmin({
      name: input.name,
      email: input.email,
      passwordHash,
      organizationName: input.organizationName,
      organizationSlug: input.organizationSlug,
      sessionTokenHash: dependencies.sessionTokenService.hash(sessionToken),
      sessionExpiresAt: expiresAt,
    });

  if (result.kind === "CONFLICT") {
    throw new RegistrationConflictError();
  }

  return { actor: result.actor, sessionToken, expiresAt };
}
