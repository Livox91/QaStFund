import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toCapacityResponse } from "@/modules/policies/api/policy-response";
import { getBorrowingCapacityForActor } from "@/modules/policies/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return apiSuccess(
      toCapacityResponse(
        await getBorrowingCapacityForActor(await getCurrentActor()),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
