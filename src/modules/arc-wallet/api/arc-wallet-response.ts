import type { ArcWallet } from "@/modules/arc-wallet/domain/arc-wallet";

export function toArcWalletResponse(
  wallet: ArcWallet | null,
  onChainBalance: string | null = null,
) {
  if (!wallet) {
    return {
      status: "NOT_CONFIGURED" as const,
      address: null,
      network: "ARC_TESTNET" as const,
      chainId: 5_042_002,
      walletType: "CIRCLE_MODULAR" as const,
      enrollmentState: "NOT_STARTED" as const,
      onChainBalance: null,
      asset: "USDC" as const,
    };
  }
  return {
    status: wallet.status,
    address: wallet.address,
    network: wallet.network,
    chainId: wallet.chainId,
    walletType: wallet.walletType,
    enrollmentState: wallet.enrollmentState,
    onChainBalance,
    asset: "USDC" as const,
  };
}
