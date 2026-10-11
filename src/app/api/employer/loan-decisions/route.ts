import type { NextRequest } from "next/server";

import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { listEmployerOriginationDecisionsForActor } from "@/modules/loan-decisions/application/origination-decisions";
import { originationDecisionStatusSchema } from "@/modules/loan-decisions/schemas/origination-decision.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "employer.loan-decision.list",
      "administrative",
    );
    const rawStatus = request.nextUrl.searchParams.get("status");
    const status = rawStatus
      ? originationDecisionStatusSchema.parse(rawStatus)
      : undefined;
    return apiSuccess({
      decisions: await listEmployerOriginationDecisionsForActor(actor, status),
    });
  } catch (error) {
    return apiError(error);
  }
}
