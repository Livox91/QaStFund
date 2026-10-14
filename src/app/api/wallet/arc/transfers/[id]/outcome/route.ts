import type { NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { recordArcUsdcTransferOutcome } from "@/modules/arc-wallet/index.server";
import { failArcUsdcTransferSchema } from "@/modules/arc-wallet/schemas/arc-usdc-transfer.schema";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { readLimitedJson } from "@/shared/api/read-json-body";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/wallet/arc/transfers/[id]/outcome">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "wallet.arc.transfer.outcome",
      "sensitive",
    );
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      throw new ApplicationError(
        "ARC_TRANSFER_NOT_FOUND",
        "Transfer not found.",
        404,
      );
    const parsed = failArcUsdcTransferSchema.safeParse(
      await readLimitedJson(request),
    );
    if (!parsed.success)
      throw new ApplicationError(
        "ARC_TRANSFER_OUTCOME_INVALID",
        "Invalid transfer outcome.",
        400,
      );
    return apiSuccess({
      transfer: await recordArcUsdcTransferOutcome(
        actor,
        id,
        parsed.data.outcome,
      ),
    });
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc transfer outcome recording failed", error);
    return apiError(error);
  }
}
