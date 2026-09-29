import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toLoanResponse } from "@/modules/loans/api/loan-response";
import { listFundedLoansForActor } from "@/modules/loans/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const actor = requireAuthenticatedUser(await getCurrentActor());
    const loans = await listFundedLoansForActor(actor);
    return apiSuccess({ loans: loans.map(toLoanResponse) });
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Funded-loan list request failed", error);
    }
    return apiError(error);
  }
}
