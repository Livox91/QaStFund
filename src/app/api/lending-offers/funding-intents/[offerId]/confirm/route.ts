import type { NextRequest } from "next/server";
import type { Hex } from "viem";
import { z } from "zod";

import { logger } from "@/infrastructure/logging/logger";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { confirmFundedLendingOffer } from "@/modules/lending/application/funded-lending-offer";
import { confirmFundedLendingOfferSchema } from "@/modules/lending/schemas/funded-lending-offer.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/lending-offers/funding-intents/[offerId]/confirm">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    const { offerId } = await context.params;
    if (!z.uuid().safeParse(offerId).success) {
      throw new ApplicationError("OFFER_NOT_FOUND", "Offer not found.", 404);
    }
    const parsed = confirmFundedLendingOfferSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      throw new ApplicationError(
        "INVALID_TRANSACTION_HASH",
        "A valid Arc transaction hash is required.",
        400,
      );
    }
    const offer = await confirmFundedLendingOffer(
      actor,
      offerId,
      parsed.data.transactionHash as Hex,
    );
    return apiSuccess({ offer });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Lending funding confirmation failed", error);
    }
    return apiError(error);
  }
}
