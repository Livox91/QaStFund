import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { apiError } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    requireAuthenticatedUser(await getCurrentActor());
    throw new ApplicationError(
      "ONCHAIN_ACCEPTANCE_REQUIRED",
      "Accept offers through the wallet confirmation flow.",
      405,
    );
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Borrow request failed", error);
    }
    return apiError(error);
  }
}
