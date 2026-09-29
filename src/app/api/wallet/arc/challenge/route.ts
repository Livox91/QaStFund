import { logger } from "@/infrastructure/logging/logger";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { issueArcWalletChallengeForActor } from "@/modules/arc-wallet/index.server";
import { createArcWalletChallengeSchema } from "@/modules/arc-wallet/schemas/arc-wallet.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = createArcWalletChallengeSchema.parse(await request.json());
    const challenge = await issueArcWalletChallengeForActor(
      await getCurrentActor(),
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
