import { logger } from "@/infrastructure/logging/logger";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { toWalletTransactionResponse } from "@/modules/ledger/api/wallet-response";
import { getWalletForActor } from "@/modules/ledger/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const wallet = await getWalletForActor(await getCurrentActor());
    return apiSuccess({
      transactions: wallet.transactions.map(toWalletTransactionResponse),
    });
  } catch (error) {
    if (!(error instanceof ApplicationError))
      logger.error("Wallet history request failed", error);
    return apiError(error);
  }
}
