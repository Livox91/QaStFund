import type { NextRequest } from "next/server";
import type { Hex } from "viem";
import { z } from "zod";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { confirmOnChainRepayment } from "@/modules/loans/application/onchain-repayment";
import { confirmOnChainRepaymentSchema } from "@/modules/loans/schemas/onchain-repayment.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/loans/[id]/repayment-intents/[repaymentId]/confirm">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(actor, "loan.repayment.confirm", "sensitive");
    const { id: loanId, repaymentId } = await context.params;
    if (
      !z.uuid().safeParse(loanId).success ||
      !z.uuid().safeParse(repaymentId).success
    ) {
      throw new ApplicationError("LOAN_NOT_FOUND", "Loan not found.", 404);
    }
    const parsed = confirmOnChainRepaymentSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      throw new ApplicationError(
        "INVALID_TRANSACTION_HASH",
        "A valid Arc transaction hash is required.",
        400,
      );
    }
    const loan = await confirmOnChainRepayment(
      actor,
      loanId,
      repaymentId,
      parsed.data.transactionHash as Hex,
    );
    return apiSuccess({ loan });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("On-chain repayment confirmation failed", error);
    }
    return apiError(error);
  }
}
