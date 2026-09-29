import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import {
  InvalidLendingOfferTermsError,
  LendingOfferNotFoundError,
} from "@/modules/lending/application/errors/lending-offer-errors";
import { toLendingOfferResponse } from "@/modules/lending/api/lending-offer-response";
import { updateLendingOfferStatusForActor } from "@/modules/lending/index.server";
import {
  lendingOfferIdSchema,
  updateLendingOfferStatusSchema,
} from "@/modules/lending/schemas/lending-offer-api.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireAuthenticatedUser(await getCurrentActor());
    const parsedId = lendingOfferIdSchema.safeParse((await params).id);
    if (!parsedId.success) throw new LendingOfferNotFoundError();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new InvalidLendingOfferTermsError();
    }
    const parsedStatus = updateLendingOfferStatusSchema.safeParse(body);
    if (!parsedStatus.success) throw new InvalidLendingOfferTermsError();

    const offer = await updateLendingOfferStatusForActor(
      actor,
      parsedId.data,
      parsedStatus.data.status,
    );
    return apiSuccess({ offer: toLendingOfferResponse(offer) });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Lending-offer status update failed", error);
    }
    return apiError(error);
  }
}
