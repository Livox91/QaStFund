import { z } from "zod";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { getArcUsdcTransfer } from "@/modules/arc-wallet/index.server";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/wallet/arc/transfers/[id]">,
): Promise<Response> {
  try {
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "wallet.arc.transfer.status",
      "administrative",
    );
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) {
      throw new ApplicationError(
        "ARC_TRANSFER_NOT_FOUND",
        "Transfer not found.",
        404,
      );
    }
    return apiSuccess({ transfer: await getArcUsdcTransfer(actor, id) });
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc transfer status request failed", error);
    return apiError(error);
  }
}
