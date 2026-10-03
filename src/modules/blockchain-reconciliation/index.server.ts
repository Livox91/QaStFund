import "server-only";

import { validateEnvironment } from "@/infrastructure/config/environment";
import { ARC_TESTNET_CHAIN_ID } from "@/integrations/arc/arc-testnet";
import { getConfiguredEscrowAddress } from "@/integrations/arc/employee-lending-escrow";
import { reconcileBlockchainEvents } from "@/modules/blockchain-reconciliation/application/reconcile-blockchain-events";
import { prismaReconciliationRepository } from "@/modules/blockchain-reconciliation/infrastructure/prisma-reconciliation-repository";
import { createViemArcEventSource } from "@/modules/blockchain-reconciliation/infrastructure/viem-arc-event-source";

export async function runConfiguredArcReconciliation() {
  const environment = validateEnvironment();
  if (!environment.ARC_RECONCILIATION_ENABLED) {
    throw new Error("Arc reconciliation is disabled");
  }
  const contractAddress = getConfiguredEscrowAddress();
  if (!contractAddress) {
    throw new Error("Arc lending contract address is not configured");
  }
  return reconcileBlockchainEvents(
    {
      chainId: ARC_TESTNET_CHAIN_ID,
      contractAddress: contractAddress.toLowerCase(),
      startBlock: environment.ARC_RECONCILIATION_START_BLOCK,
      confirmationDepth: environment.ARC_RECONCILIATION_CONFIRMATIONS,
      blockRange: environment.ARC_RECONCILIATION_BLOCK_RANGE,
      reorgWindow: environment.ARC_RECONCILIATION_REORG_WINDOW,
      maxRangesPerRun: environment.ARC_RECONCILIATION_MAX_RANGES,
      eventBatchSize: 500,
      rpcMaxRetries: environment.ARC_RECONCILIATION_RPC_RETRIES,
      retryBaseDelayMs: 250,
      leaseDurationMs: 5 * 60_000,
    },
    prismaReconciliationRepository,
    createViemArcEventSource({
      contractAddress,
      rpcUrl: environment.ARC_RECONCILIATION_RPC_URL,
    }),
  );
}
