import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import {
  IdempotencyKeyRequiredError,
  InvalidBorrowRequestError,
} from "@/modules/loans/application/errors/borrow-loan-errors";
import { toCreatedLoanResponse } from "@/modules/loans/api/loan-response";
import { borrowFromOfferForActor } from "@/modules/loans/index.server";
import {
  borrowIdempotencyKeySchema,
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
    const parsedParams = borrowOfferParamsSchema.safeParse({
      offerId: (await params).id,
    });
    if (!parsedParams.success) throw new InvalidBorrowRequestError();

    const parsedKey = borrowIdempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    if (!parsedKey.success) throw new IdempotencyKeyRequiredError();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new InvalidBorrowRequestError();
    }
    const parsedBody = borrowOfferApiSchema.safeParse(body);
    if (!parsedBody.success) throw new InvalidBorrowRequestError();

    const loan = await borrowFromOfferForActor(actor, {
      offerId: parsedParams.data.offerId,
      amountMinorUnits: parsedBody.data.amount,
      requestId: parsedKey.data,
    });
    return apiSuccess({ loan: toCreatedLoanResponse(loan) }, 201);
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Borrow request failed", error);
    }
    return apiError(error);
  }
}
