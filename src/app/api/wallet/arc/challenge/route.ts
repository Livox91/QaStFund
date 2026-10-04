import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { issueArcWalletChallengeForActor } from "@/modules/arc-wallet/index.server";
import { createArcWalletChallengeSchema } from "@/modules/arc-wallet/schemas/arc-wallet.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(actor, "wallet.challenge.create", "sensitive");
    const input = createArcWalletChallengeSchema.parse(await request.json());
    const challenge = await issueArcWalletChallengeForActor(
      actor,
      input.address,
    );
    return apiSuccess(
      {
        challengeId: challenge.challengeId,
        address: challenge.address,
        nonce: challenge.nonce,
        message: challenge.message,
        expiresAt: challenge.expiresAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc wallet challenge creation failed", error);
    return apiError(error);
  }
}
