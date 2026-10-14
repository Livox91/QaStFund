import type { NextRequest } from "next/server";
import type { Hex } from "viem";
import { z } from "zod";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { confirmArcUsdcTransfer } from "@/modules/arc-wallet/index.server";
import { confirmArcUsdcTransferSchema } from "@/modules/arc-wallet/schemas/arc-usdc-transfer.schema";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { readLimitedJson } from "@/shared/api/read-json-body";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/wallet/arc/transfers/[id]/confirm">,
): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "wallet.arc.transfer.confirm",
      "sensitive",
    );
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success)
      throw new ApplicationError(
        "ARC_TRANSFER_NOT_FOUND",
        "Transfer not found.",
        404,
      );
    const parsed = confirmArcUsdcTransferSchema.safeParse(
      await readLimitedJson(request),
    );
    if (!parsed.success)
      throw new ApplicationError(
        "ARC_TRANSFER_CONFIRMATION_INVALID",
        parsed.error.issues[0]?.message ?? "Invalid confirmation.",
        400,
      );
    return apiSuccess({
      transfer: await confirmArcUsdcTransfer(
        actor,
        id,
        parsed.data.transactionHash as Hex,
      ),
    });
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc transfer confirmation failed", error);
    return apiError(error);
  }
}
