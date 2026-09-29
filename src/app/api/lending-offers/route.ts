import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { InvalidLendingOfferTermsError } from "@/modules/lending/application/errors/lending-offer-errors";
import { toLendingOfferResponse } from "@/modules/lending/api/lending-offer-response";
import {
  createLendingOfferForActor,
  listActiveLendingOffersForActor,
} from "@/modules/lending/index.server";
import {
  createLendingOfferApiSchema,
  toCreateLendingOfferCommand,
} from "@/modules/lending/schemas/lending-offer-api.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const actor = requireAuthenticatedUser(await getCurrentActor());
    const offers = await listActiveLendingOffersForActor(actor);
    return apiSuccess({ offers: offers.map(toLendingOfferResponse) });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Lending-offer marketplace request failed", error);
    }
    return apiError(error);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireAuthenticatedUser(await getCurrentActor());
    const now = new Date();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new InvalidLendingOfferTermsError();
    }

    const parsed = createLendingOfferApiSchema.safeParse(body);
    if (!parsed.success) throw new InvalidLendingOfferTermsError();

    const offer = await createLendingOfferForActor(
      actor,
      toCreateLendingOfferCommand(parsed.data, now),
      now,
    );
    return apiSuccess({ offer: toLendingOfferResponse(offer) }, 201);
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Lending-offer creation failed", error);
    }
    return apiError(error);
  }
}
