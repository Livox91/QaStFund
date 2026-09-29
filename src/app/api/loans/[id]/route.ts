import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { LoanNotFoundError } from "@/modules/loans/application/errors/borrow-loan-errors";
import { toLoanResponse } from "@/modules/loans/api/loan-response";
import { getAccessibleLoanForActor } from "@/modules/loans/index.server";
import { loanIdSchema } from "@/modules/loans/schemas/borrow-from-offer.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = requireAuthenticatedUser(await getCurrentActor());
    const parsedId = loanIdSchema.safeParse((await params).id);
    if (!parsedId.success) throw new LoanNotFoundError();

    const loan = await getAccessibleLoanForActor(actor, parsedId.data);
    return apiSuccess({ loan: toLoanResponse(loan) });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Loan detail request failed", error);
    }
    return apiError(error);
  }
}
