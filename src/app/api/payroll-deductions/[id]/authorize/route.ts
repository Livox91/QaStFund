import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { authorizePayrollDeduction } from "@/modules/payroll-operations/index.server";
import { proposalIdSchema } from "@/modules/payroll-operations/schemas";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: RouteContext<"/api/payroll-deductions/[id]/authorize">,
) {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "payroll-deduction.authorize",
      "sensitive",
    );
    const id = proposalIdSchema.safeParse((await context.params).id);
    if (!id.success)
      throw new ApplicationError(
        "INVALID_PAYROLL_PROPOSAL",
        "Invalid proposal.",
        400,
      );
    const proposal = await authorizePayrollDeduction(actor, id.data);
    return apiSuccess({
      proposal: {
        id: proposal.id,
        status: proposal.status,
        authorizationStatus: proposal.authorizationStatus,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
