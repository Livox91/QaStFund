import type { NextRequest } from "next/server";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toPolicyResponse } from "@/modules/policies/api/policy-response";
import {
  getEmployerPolicyForActor,
  updatePolicyForActor,
} from "@/modules/policies/index.server";
import { lendingPolicySchema } from "@/modules/policies/schemas/lending-policy.schema";
import { InvalidLendingPolicyError } from "@/modules/policies/application/errors";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return apiSuccess(
      toPolicyResponse(
        await getEmployerPolicyForActor(await getCurrentActor()),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertTrustedRequestOrigin(request);
    const parsed = lendingPolicySchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) throw new InvalidLendingPolicyError();
    const data = parsed.data;
    const policy = await updatePolicyForActor(await getCurrentActor(), {
      lendingEnabled: data.lendingEnabled,
      borrowingEnabled: data.borrowingEnabled,
      maxLoanAmountMinorUnits: data.maxLoanAmount,
      maxOutstandingDebtMinorUnits: data.maxOutstandingDebt,
      maxActiveLoans: data.maxActiveLoans,
      minInterestRateBasisPoints: data.minInterestRate,
      maxInterestRateBasisPoints: data.maxInterestRate,
      minTermDays: data.minTermDays,
      maxTermDays: data.maxTermDays,
    });
    return apiSuccess(toPolicyResponse(policy));
  } catch (error) {
    return apiError(error);
  }
}
