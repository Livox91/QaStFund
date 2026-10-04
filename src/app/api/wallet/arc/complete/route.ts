import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toArcWalletResponse } from "@/modules/arc-wallet/api/arc-wallet-response";
import { completeArcWalletChallengeForActor } from "@/modules/arc-wallet/index.server";
import { completeArcWalletChallengeSchema } from "@/modules/arc-wallet/schemas/arc-wallet.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "wallet.enrollment.complete",
      "sensitive",
    );
    const input = completeArcWalletChallengeSchema.parse(await request.json());
    const wallet = await completeArcWalletChallengeForActor(actor, input);
    return apiSuccess({ arc: toArcWalletResponse(wallet) });
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc wallet enrollment completion failed", error);
    return apiError(error);
  }
}
