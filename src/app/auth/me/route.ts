import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { toCurrentSession } from "@/modules/auth/domain/current-session";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const actor = requireAuthenticatedUser(await getCurrentActor());
    return apiSuccess({ session: toCurrentSession(actor) });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Current-session request failed", error);
    }
    return apiError(error);
  }
}
