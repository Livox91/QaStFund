import "server-only";

import { createPublicClient, formatUnits, http, type Hex } from "viem";

import {
  ARC_USDC_ADDRESS,
  ARC_USDC_DECIMALS,
  ARC_TESTNET_RPC_URL,
  arcTestnet,
} from "@/integrations/arc/arc-testnet";
import { ArcWalletProviderError } from "@/modules/arc-wallet/application/errors";
import { erc20UsdcAbi } from "@/integrations/arc/employee-lending-escrow";

function createArcClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_TESTNET_RPC_URL),
  });
}

export async function verifyCircleArcWalletSignature(input: {
  address: `0x${string}`;
  message: string;
  signature: Hex;
}): Promise<boolean> {
  try {
    return await createArcClient().verifyMessage(input);
  } catch (error) {
    throw new ArcWalletProviderError(error);
  }
}

export async function getArcNativeUsdcBalance(
  address: `0x${string}`,
): Promise<string> {
  try {
    const balance = await createArcClient().readContract({
      address: ARC_USDC_ADDRESS,
      abi: erc20UsdcAbi,
      functionName: "balanceOf",
      args: [address],
    });
    return formatUnits(balance, ARC_USDC_DECIMALS);
  } catch (error) {
    throw new ArcWalletProviderError(error);
  }
}
