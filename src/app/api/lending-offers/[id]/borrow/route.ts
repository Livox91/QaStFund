import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { borrowFromOfferForActor } from "@/modules/loans/index.server";
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
  context: RouteContext<"/api/lending-offers/[id]/borrow">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "loan.legacy-acceptance.create",
      "sensitive",
    );
    const parsedParams = borrowOfferParamsSchema.safeParse({
      offerId: (await context.params).id,
    });
    const parsed = borrowOfferApiSchema.safeParse(await request.json());
    if (!parsedParams.success || !parsed.success) {
      throw new ApplicationError(
        "INVALID_BORROW_REQUEST",
        "The borrowing request is invalid.",
        400,
      );
    }
    const loan = await borrowFromOfferForActor(actor, {
      offerId: parsedParams.data.offerId,
      amountMinorUnits: parsed.data.amount,
      requestId: parsed.data.requestId,
      termMonths: parsed.data.termMonths,
    });
    return apiSuccess(
      {
        loan: {
          ...loan,
          principalAmountMinorUnits: loan.principalAmountMinorUnits.toString(),
          feeAmountMinorUnits: loan.feeAmountMinorUnits.toString(),
          totalRepaymentMinorUnits: loan.totalRepaymentMinorUnits.toString(),
        },
      },
      201,
    );
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Borrow request failed", error);
    }
    return apiError(error);
  }
}
