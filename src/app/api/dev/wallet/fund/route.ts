import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { fundWalletForActor } from "@/modules/ledger/index.server";
import { InvalidFundingAmountError } from "@/modules/ledger/application/errors/ledger-errors";
import {
  fundWalletIdempotencyKeySchema,
  fundWalletSchema,
} from "@/modules/ledger/schemas/fund-wallet.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  if (process.env.NODE_ENV === "production")
    return new Response(null, { status: 404 });
  try {
    assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(actor, "development.wallet.fund", "sensitive");
    const key = fundWalletIdempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    const body = fundWalletSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!key.success || !body.success) throw new InvalidFundingAmountError();
    const result = await fundWalletForActor(actor, {
      amountMinorUnits: body.data.amount,
      requestId: key.data,
    });
    return apiSuccess(
      { transactionId: result.transaction.id },
      result.alreadyPosted ? 200 : 201,
    );
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Development funding failed", error);
    return apiError(error);
  }
}
