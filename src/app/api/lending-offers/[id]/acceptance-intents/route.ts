import type { NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/infrastructure/logging/logger";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { prepareOnChainBorrow } from "@/modules/loans/application/onchain-borrow";
import { prepareOnChainBorrowSchema } from "@/modules/loans/schemas/onchain-borrow.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/lending-offers/[id]/acceptance-intents">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    const { id: offerId } = await context.params;
    if (!z.uuid().safeParse(offerId).success) {
      throw new ApplicationError(
        "LENDING_OFFER_NOT_AVAILABLE",
        "This offer is no longer available. Choose another lending offer.",
        409,
      );
    }
    const parsed = prepareOnChainBorrowSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApplicationError(
        "INVALID_BORROW_REQUEST",
        "The borrowing request is invalid.",
        400,
      );
    }
    const intent = await prepareOnChainBorrow(
      actor,
      offerId,
      parsed.data.requestId,
    );
    return apiSuccess({ intent }, 201);
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("On-chain borrowing intent failed", error);
    }
    return apiError(error);
  }
}
