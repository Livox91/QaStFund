import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { IdempotencyKeyRequiredError } from "@/modules/loans/application/errors/borrow-loan-errors";
import { InvalidRepaymentError } from "@/modules/loans/application/errors/repay-loan-errors";
import { toRecordedRepaymentResponse } from "@/modules/loans/api/loan-response";
import { repayLoanForActor } from "@/modules/loans/index.server";
import {
  employeeLoanIdSchema,
  repaymentIdempotencyKeySchema,
  repayLoanApiSchema,
} from "@/modules/loans/schemas/repay-loan.schema";
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
    const parsedLoanId = employeeLoanIdSchema.safeParse((await params).id);
    const parsedKey = repaymentIdempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    if (!parsedLoanId.success) throw new InvalidRepaymentError();
    if (!parsedKey.success) throw new IdempotencyKeyRequiredError();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new InvalidRepaymentError();
    }
    const parsedBody = repayLoanApiSchema.safeParse(body);
    if (!parsedBody.success) throw new InvalidRepaymentError();

    const repayment = await repayLoanForActor(actor, {
      loanId: parsedLoanId.data,
      amountMinorUnits: parsedBody.data.amount,
      requestId: parsedKey.data,
    });
    return apiSuccess(
      { repayment: toRecordedRepaymentResponse(repayment) },
      201,
    );
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Loan repayment request failed", error);
    }
    return apiError(error);
  }
}
