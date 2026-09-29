import { logger } from "@/infrastructure/logging/logger";
import { toArcWalletResponse } from "@/modules/arc-wallet/api/arc-wallet-response";
import {
  getArcNativeUsdcBalance,
  getArcWalletForActor,
} from "@/modules/arc-wallet/index.server";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toWalletResponse } from "@/modules/ledger/api/wallet-response";
import { getWalletForActor } from "@/modules/ledger/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const actor = await getCurrentActor();
    const [internalWallet, arcWallet] = await Promise.all([
      getWalletForActor(actor),
      getArcWalletForActor(actor),
    ]);
    const onChainBalance =
      arcWallet?.status === "ACTIVE" && arcWallet.address
        ? await getArcNativeUsdcBalance(arcWallet.address)
        : null;
    return apiSuccess({
      internal: toWalletResponse(internalWallet),
      arc: toArcWalletResponse(arcWallet, onChainBalance),
    });
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Wallet request failed", error);
    return apiError(error);
  }
}
