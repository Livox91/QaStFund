import { logger } from "@/infrastructure/logging/logger";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { beginArcWalletEnrollmentForActor } from "@/modules/arc-wallet/index.server";
import { beginArcWalletEnrollmentSchema } from "@/modules/arc-wallet/schemas/arc-wallet-enrollment.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const input = beginArcWalletEnrollmentSchema.parse(await request.json());
    return apiSuccess(
      await beginArcWalletEnrollmentForActor(
        await getCurrentActor(),
        input.intent,
      ),
    );
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Arc wallet enrollment start failed", error);
    return apiError(error);
  }
}
