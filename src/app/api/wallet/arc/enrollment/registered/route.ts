import { logger } from "@/infrastructure/logging/logger";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { markArcWalletRegistrationCompleteForActor } from "@/modules/arc-wallet/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  try {
    await markArcWalletRegistrationCompleteForActor(await getCurrentActor());
    return apiSuccess({ status: "REGISTERED" as const });
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc wallet registration state update failed", error);
    return apiError(error);
  }
}
