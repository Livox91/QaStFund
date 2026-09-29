import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toLendingOfferResponse } from "@/modules/lending/api/lending-offer-response";
import { listActiveLendingOffersForActor } from "@/modules/lending/index.server";
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
    requireAuthenticatedUser(await getCurrentActor());
    throw new ApplicationError(
      "ONCHAIN_FUNDING_REQUIRED",
      "Create offers through the wallet funding flow.",
      405,
    );
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Lending-offer creation failed", error);
    }
    return apiError(error);
  }
}
