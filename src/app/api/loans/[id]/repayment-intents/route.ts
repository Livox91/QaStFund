import type { NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { prepareOnChainRepayment } from "@/modules/loans/application/onchain-repayment";
import { prepareOnChainRepaymentSchema } from "@/modules/loans/schemas/onchain-repayment.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/loans/[id]/repayment-intents">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(actor, "loan.repayment.create", "sensitive");
    const { id: loanId } = await context.params;
    if (!z.uuid().safeParse(loanId).success) {
      throw new ApplicationError("LOAN_NOT_FOUND", "Loan not found.", 404);
    }
    const parsed = prepareOnChainRepaymentSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      throw new ApplicationError(
        "INVALID_REPAYMENT_REQUEST",
        "The repayment request is invalid.",
        400,
      );
    }
    const intent = await prepareOnChainRepayment(
      actor,
      loanId,
      parsed.data.requestId,
    );
    return apiSuccess({ intent }, 201);
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("On-chain repayment intent failed", error);
    }
    return apiError(error);
  }
}
