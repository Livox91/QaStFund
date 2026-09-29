import { logger } from "@/infrastructure/logging/logger";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toArcWalletResponse } from "@/modules/arc-wallet/api/arc-wallet-response";
import { completeArcWalletChallengeForActor } from "@/modules/arc-wallet/index.server";
import { completeArcWalletChallengeSchema } from "@/modules/arc-wallet/schemas/arc-wallet.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = completeArcWalletChallengeSchema.parse(await request.json());
    const wallet = await completeArcWalletChallengeForActor(
      await getCurrentActor(),
      input,
    );
    return apiSuccess({ arc: toArcWalletResponse(wallet) });
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc wallet enrollment completion failed", error);
    return apiError(error);
  }
}
