import type { NextRequest } from "next/server";
import { z } from "zod";

import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployeeOriginationDecisionForActor } from "@/modules/loan-decisions/application/origination-decisions";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/loans/[id]/origination-decision">,
): Promise<Response> {
  try {
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "loan.origination-decision.read",
      "sensitive",
    );
    const { id: loanId } = await context.params;
    if (!z.uuid().safeParse(loanId).success) {
      throw new ApplicationError(
        "LOAN_DECISION_NOT_FOUND",
        "Loan decision not found.",
        404,
      );
    }
    const decision = await getEmployeeOriginationDecisionForActor(
      actor,
      loanId,
    );
    return apiSuccess({ decision });
  } catch (error) {
    return apiError(error);
  }
}
