import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import {
  createPayrollDeductionProposal,
  listPayrollDeductions,
} from "@/modules/payroll-operations/index.server";
import { createPayrollProposalSchema } from "@/modules/payroll-operations/schemas";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "payroll-deduction.list",
      "administrative",
    );
    const proposals = await listPayrollDeductions(actor);
    return apiSuccess({
      proposals: JSON.parse(
        JSON.stringify(proposals, (_, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "payroll-deduction.create",
      "administrative",
    );
    const parsed = createPayrollProposalSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new ApplicationError(
        "INVALID_PAYROLL_PROPOSAL",
        "Invalid payroll proposal.",
        400,
      );
    const proposal = await createPayrollDeductionProposal(actor, {
      installmentId: parsed.data.installmentId,
      payrollPeriodStart: parsed.data.payrollPeriodStart,
      payrollPeriodEnd: parsed.data.payrollPeriodEnd,
      proposedAmountMinorUnits: parsed.data.proposedAmount,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return apiSuccess(
      {
        proposal: {
          ...proposal,
          scheduledAmountMinorUnits:
            proposal.scheduledAmountMinorUnits.toString(),
          outstandingAmountMinorUnits:
            proposal.outstandingAmountMinorUnits.toString(),
          proposedAmountMinorUnits:
            proposal.proposedAmountMinorUnits.toString(),
          actualDeductedMinorUnits:
            proposal.actualDeductedMinorUnits.toString(),
        },
      },
      201,
    );
  } catch (error) {
    return apiError(error);
  }
}
