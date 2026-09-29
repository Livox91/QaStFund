import type { NextRequest } from "next/server";
import type { Hex } from "viem";
import { z } from "zod";

import { logger } from "@/infrastructure/logging/logger";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { confirmOnChainBorrow } from "@/modules/loans/application/onchain-borrow";
import { confirmOnChainBorrowSchema } from "@/modules/loans/schemas/onchain-borrow.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/loans/[loanId]/acceptance/confirm">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    const { loanId } = await context.params;
    if (!z.uuid().safeParse(loanId).success) {
      throw new ApplicationError("LOAN_NOT_FOUND", "Loan not found.", 404);
    }
    const parsed = confirmOnChainBorrowSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApplicationError(
        "INVALID_TRANSACTION_HASH",
        "A valid Arc transaction hash is required.",
        400,
      );
    }
    const loan = await confirmOnChainBorrow(
      actor,
      loanId,
      parsed.data.transactionHash as Hex,
    );
    return apiSuccess({ loan });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("On-chain borrowing confirmation failed", error);
    }
    return apiError(error);
  }
}
