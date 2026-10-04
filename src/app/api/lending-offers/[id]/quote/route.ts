import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { InvalidBorrowRequestError } from "@/modules/loans/application/errors/borrow-loan-errors";
import { toBorrowQuoteResponse } from "@/modules/loans/api/loan-response";
import { quoteBorrowFromOfferForActor } from "@/modules/loans/index.server";
import {
  borrowOfferApiSchema,
  borrowOfferParamsSchema,
} from "@/modules/loans/schemas/borrow-from-offer.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireAuthenticatedUser(await getCurrentActor());
    await enforceUserRateLimit(actor, "loan.quote", "expensive");
    const parsedParams = borrowOfferParamsSchema.safeParse({
      offerId: (await params).id,
    });
    if (!parsedParams.success) throw new InvalidBorrowRequestError();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new InvalidBorrowRequestError();
    }
    const parsedBody = borrowOfferApiSchema.safeParse(body);
    if (!parsedBody.success) throw new InvalidBorrowRequestError();

    const quote = await quoteBorrowFromOfferForActor(
      actor,
      parsedParams.data.offerId,
      parsedBody.data.amount,
    );
    return apiSuccess({ quote: toBorrowQuoteResponse(quote) });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Borrow quote request failed", error);
    }
    return apiError(error);
  }
}
