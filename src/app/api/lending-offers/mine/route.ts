import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toLendingOfferResponse } from "@/modules/lending/api/lending-offer-response";
import { getEmployeeLendingForActor } from "@/modules/lending/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const actor = requireAuthenticatedUser(await getCurrentActor());
    const lending = await getEmployeeLendingForActor(actor);
    return apiSuccess({ offers: lending.offers.map(toLendingOfferResponse) });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Personal lending-offer request failed", error);
    }
    return apiError(error);
  }
}
