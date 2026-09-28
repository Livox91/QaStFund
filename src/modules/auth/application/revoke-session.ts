import type { AuthRepository } from "@/modules/auth/application/ports/auth-repository";
import type { SessionTokenService } from "@/modules/auth/application/ports/session-token-service";

export async function revokeSession(
  sessionToken: string | undefined,
  dependencies: {
    authRepository: AuthRepository;
    sessionTokenService: SessionTokenService;
  },
): Promise<void> {
  if (!sessionToken) {
    return;
  }

  await dependencies.authRepository.deleteSessionByTokenHash(
    dependencies.sessionTokenService.hash(sessionToken),
  );
}
