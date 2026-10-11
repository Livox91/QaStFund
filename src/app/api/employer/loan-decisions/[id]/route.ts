import type { NextRequest } from "next/server";

import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import {
  getEmployerOriginationDecisionForActor,
  overrideOriginationDecisionForActor,
} from "@/modules/loan-decisions/application/origination-decisions";
import {
  originationDecisionIdSchema,
  originationDecisionOverrideSchema,
} from "@/modules/loan-decisions/schemas/origination-decision.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/employer/loan-decisions/[id]">,
): Promise<Response> {
  try {
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "employer.loan-decision.read",
      "administrative",
    );
    const decisionId = originationDecisionIdSchema.parse(
      (await context.params).id,
    );
    return apiSuccess({
      decision: await getEmployerOriginationDecisionForActor(actor, decisionId),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/employer/loan-decisions/[id]">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "employer.loan-decision.override",
      "administrative",
    );
    const decisionId = originationDecisionIdSchema.parse(
      (await context.params).id,
    );
    const override = originationDecisionOverrideSchema.parse(
      await request.json(),
    );
    return apiSuccess({
      override: await overrideOriginationDecisionForActor(actor, {
        decisionId,
        ...override,
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
