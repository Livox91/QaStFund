import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { LendingOfferNotFoundError } from "@/modules/lending/application/errors/lending-offer-errors";
import { toLendingOfferResponse } from "@/modules/lending/api/lending-offer-response";
import { getLendingOfferForActor } from "@/modules/lending/index.server";
import { lendingOfferIdSchema } from "@/modules/lending/schemas/lending-offer-api.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = requireAuthenticatedUser(await getCurrentActor());
    const parsedId = lendingOfferIdSchema.safeParse((await params).id);
    if (!parsedId.success) throw new LendingOfferNotFoundError();

    const offer = await getLendingOfferForActor(actor, parsedId.data);
    return apiSuccess({ offer: toLendingOfferResponse(offer) });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Lending-offer detail request failed", error);
    }
    return apiError(error);
  }
}
