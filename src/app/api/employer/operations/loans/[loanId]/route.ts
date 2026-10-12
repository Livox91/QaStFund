import type { NextRequest } from "next/server";
import { z } from "zod";

import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { investigateLoanOperationsForActor } from "@/modules/operations/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/employer/operations/loans/[loanId]">,
): Promise<Response> {
  try {
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "employer.operations.loan-trace.read",
      "administrative",
    );
    const loanId = z.uuid().parse((await context.params).loanId);
    return apiSuccess({
      trace: await investigateLoanOperationsForActor(actor, loanId),
    });
  } catch (error) {
    return apiError(error);
  }
}
