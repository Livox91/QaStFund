import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { actOnDelinquencyCase } from "@/modules/payroll-operations/index.server";
import {
  delinquencyActionSchema,
  proposalIdSchema,
} from "@/modules/payroll-operations/schemas";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/employer/delinquency/[id]">,
) {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(actor, "delinquency.update", "administrative");
    const id = proposalIdSchema.safeParse((await context.params).id);
    const body = delinquencyActionSchema.safeParse(await request.json());
    if (!id.success || !body.success)
      throw new ApplicationError(
        "INVALID_DELINQUENCY_ACTION",
        "Invalid delinquency action.",
        400,
      );
    const result = await actOnDelinquencyCase(actor, id.data, body.data);
    return apiSuccess({
      case: JSON.parse(
        JSON.stringify(result, (_, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
