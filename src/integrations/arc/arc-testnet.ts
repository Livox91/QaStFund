import { defineChain } from "viem";

export const ARC_TESTNET_CHAIN_ID = 5_042_002 as const;
export const ARC_TESTNET_NETWORK = "ARC_TESTNET" as const;
export const ARC_WALLET_TYPE = "CIRCLE_MODULAR" as const;
export const ARC_NATIVE_ASSET = "USDC" as const;
export const ARC_NATIVE_USDC_DECIMALS = 18;
// Arc exposes USDC through an ERC-20 interface for application transfers.
// The native 18-decimal representation is only used for gas/msg.value.
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
export const ARC_USDC_DECIMALS = 6;
export const ARC_MODULAR_TRANSPORT_PATH = "arcTestnet" as const;
export const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network" as const;

export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: {
    name: ARC_NATIVE_ASSET,
    symbol: ARC_NATIVE_ASSET,
    decimals: ARC_NATIVE_USDC_DECIMALS,
  },
  rpcUrls: {
    default: { http: [ARC_TESTNET_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export function getArcModularClientUrl(clientUrl: string): string {
  return `${clientUrl.replace(/\/$/, "")}/${ARC_MODULAR_TRANSPORT_PATH}`;
}
