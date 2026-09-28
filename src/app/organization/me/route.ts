import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { getCurrentOrganizationForActor } from "@/modules/organizations/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const actor = requireAuthenticatedUser(await getCurrentActor());
    const organization = await getCurrentOrganizationForActor(actor);
    return apiSuccess({ organization });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Current-organization request failed", error);
    }
    return apiError(error);
  }
}
