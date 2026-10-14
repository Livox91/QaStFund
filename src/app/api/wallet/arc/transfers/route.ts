import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import {
  listArcUsdcTransfers,
  prepareArcUsdcTransfer,
} from "@/modules/arc-wallet/index.server";
import { prepareArcUsdcTransferSchema } from "@/modules/arc-wallet/schemas/arc-usdc-transfer.schema";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { readLimitedJson } from "@/shared/api/read-json-body";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "wallet.arc.transfer.list",
      "administrative",
    );
    return apiSuccess({ transfers: await listArcUsdcTransfers(actor) });
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc transfer history request failed", error);
    return apiError(error);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      "wallet.arc.transfer.prepare",
      "sensitive",
    );
    const parsed = prepareArcUsdcTransferSchema.safeParse(
      await readLimitedJson(request),
    );
    if (!parsed.success) {
      throw new ApplicationError(
        "ARC_TRANSFER_INVALID",
        parsed.error.issues[0]?.message ?? "Invalid transfer details.",
        400,
      );
    }
    return apiSuccess(await prepareArcUsdcTransfer(actor, parsed.data), 201);
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc transfer preparation failed", error);
    return apiError(error);
  }
}
