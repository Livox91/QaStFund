import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { markArcWalletRegistrationCompleteForActor } from "@/modules/arc-wallet/index.server";
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
      "wallet.enrollment.registered",
      "sensitive",
    );
    await markArcWalletRegistrationCompleteForActor(actor);
    return apiSuccess({ status: "REGISTERED" as const });
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc wallet registration state update failed", error);
    return apiError(error);
  }
}
