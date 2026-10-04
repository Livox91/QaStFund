import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { prepareFundedLendingOffer } from "@/modules/lending/application/funded-lending-offer";
import { fundedLendingOfferSchema } from "@/modules/lending/schemas/funded-lending-offer.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(actor, "lending.offer.create", "sensitive");
    const parsed = fundedLendingOfferSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApplicationError(
        "INVALID_FUNDED_OFFER",
        parsed.error.issues[0]?.message ?? "Invalid offer terms.",
        400,
      );
    }
    const intent = await prepareFundedLendingOffer(actor, parsed.data);
    return apiSuccess({ intent }, 201);
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Lending funding intent failed", error);
    }
    return apiError(error);
  }
}
