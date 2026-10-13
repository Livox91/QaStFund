import type { NextRequest } from "next/server";

import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toRecordedRepaymentResponse } from "@/modules/loans/api/loan-response";
import { repayLoanForActor } from "@/modules/loans/index.server";
import {
  employeeLoanIdSchema,
  repayLoanApiSchema,
} from "@/modules/loans/schemas/repay-loan.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/loans/[id]/repay">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "loan.legacy-repayment.create",
      "sensitive",
    );
    const loanId = employeeLoanIdSchema.safeParse((await context.params).id);
    const input = repayLoanApiSchema.safeParse(await request.json());
    if (!loanId.success || !input.success) {
      throw new ApplicationError(
        "INVALID_REPAYMENT",
        "Repayment amount or request identifier is invalid.",
        400,
      );
    }
    const repayment = await repayLoanForActor(actor, {
      loanId: loanId.data,
      amountMinorUnits: input.data.amount,
      requestId: input.data.requestId,
    });
    return apiSuccess(
      { repayment: toRecordedRepaymentResponse(repayment) },
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
