import type { NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { revalidateArcUsdcTransfer } from "@/modules/arc-wallet/index.server";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/wallet/arc/transfers/[id]/authorize">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "wallet.arc.transfer.authorize",
      "sensitive",
    );
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) {
      throw new ApplicationError(
        "ARC_TRANSFER_NOT_FOUND",
        "Transfer not found.",
        404,
      );
    }
    return apiSuccess(await revalidateArcUsdcTransfer(actor, id));
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc transfer authorization failed", error);
    return apiError(error);
  }
}
