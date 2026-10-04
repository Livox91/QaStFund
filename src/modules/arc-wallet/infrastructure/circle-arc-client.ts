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
import {
  operationalFailureAlertThreshold,
  recordOperationalFailure,
  recordOperationalSuccess,
} from "@/infrastructure/observability/operational-signals";

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
    const verified = await createArcClient().verifyMessage(input);
    recordOperationalSuccess("circle");
    return verified;
  } catch (error) {
    recordOperationalFailure("circle", {
      alertThreshold: operationalFailureAlertThreshold(),
    });
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
    recordOperationalSuccess("circle");
    return formatUnits(balance, ARC_USDC_DECIMALS);
  } catch (error) {
    recordOperationalFailure("circle", {
      alertThreshold: operationalFailureAlertThreshold(),
    });
    throw new ArcWalletProviderError(error);
  }
}
