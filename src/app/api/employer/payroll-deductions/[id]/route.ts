import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import {
  reconcilePayrollDeduction,
  reviewPayrollDeduction,
  submitPayrollDeduction,
} from "@/modules/payroll-operations/index.server";
import {
  payrollActionSchema,
  proposalIdSchema,
} from "@/modules/payroll-operations/schemas";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/employer/payroll-deductions/[id]">,
) {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "payroll-deduction.update",
      "administrative",
    );
    const id = proposalIdSchema.safeParse((await context.params).id);
    const body = payrollActionSchema.safeParse(await request.json());
    if (!id.success || !body.success)
      throw new ApplicationError(
        "INVALID_PAYROLL_ACTION",
        "Invalid payroll action.",
        400,
      );
    const result =
      body.data.action === "SUBMIT"
        ? await submitPayrollDeduction(actor, id.data)
        : body.data.action === "RECONCILE"
          ? await reconcilePayrollDeduction(actor, id.data, {
              actualAmountMinorUnits: body.data.actualAmount,
              externalReference: body.data.externalReference,
            })
          : await reviewPayrollDeduction(
              actor,
              id.data,
              body.data.action,
              body.data.rationale,
            );
    return apiSuccess({
      proposal: JSON.parse(
        JSON.stringify(result, (_, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
