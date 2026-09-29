import type { NextRequest } from "next/server";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { updateEmployeeAccessForActor } from "@/modules/policies/index.server";
import {
  employeeIdSchema,
  lendingAccessSchema,
} from "@/modules/policies/schemas/lending-policy.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: RouteContext<"/api/employer/employees/[employeeId]/lending-access">,
) {
  try {
    assertTrustedRequestOrigin(request);
    const employeeId = employeeIdSchema.parse((await params).employeeId);
    const access = lendingAccessSchema.parse(await request.json());
    return apiSuccess(
      await updateEmployeeAccessForActor(
        await getCurrentActor(),
        employeeId,
        access,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
