import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toPolicyResponse } from "@/modules/policies/api/policy-response";
import { getPolicyForActor } from "@/modules/policies/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return apiSuccess(
      toPolicyResponse(await getPolicyForActor(await getCurrentActor())),
    );
  } catch (error) {
    return apiError(error);
  }
}
