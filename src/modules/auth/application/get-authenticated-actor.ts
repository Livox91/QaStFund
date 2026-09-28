import type { AuthRepository } from "@/modules/auth/application/ports/auth-repository";
import type { SessionTokenService } from "@/modules/auth/application/ports/session-token-service";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";

type GetAuthenticatedActorDependencies = Readonly<{
  authRepository: AuthRepository;
  sessionTokenService: SessionTokenService;
  now?: () => Date;
}>;

export async function getAuthenticatedActor(
  sessionToken: string | undefined,
  dependencies: GetAuthenticatedActorDependencies,
): Promise<AuthenticatedActor | null> {
  if (!sessionToken) {
    return null;
  }

  return dependencies.authRepository.findActorBySessionTokenHash(
    dependencies.sessionTokenService.hash(sessionToken),
    dependencies.now?.() ?? new Date(),
  );
}
