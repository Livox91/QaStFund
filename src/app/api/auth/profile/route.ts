import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { apiError, apiSuccess } from "@/shared/api/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const actor = requireAuthenticatedUser(await getCurrentActor());

    return apiSuccess({ profile: actor });
  } catch (error) {
    logger.error("Profile request failed", error);
    return apiError(error);
  }
}
