import "server-only";

import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Address,
} from "viem";

import type { BlockchainEnvironment } from "@/infrastructure/config/environment-schema";
import { validateBlockchainEnvironment } from "@/infrastructure/config/environment";
import {
  employeeLendingEscrowAbi,
  erc20UsdcAbi,
} from "@/integrations/arc/employee-lending-escrow";

export function createBlockchainReadClient(
  configuration: BlockchainEnvironment = validateBlockchainEnvironment(),
) {
  const chain = defineChain({
    id: configuration.CHAIN_ID,
    name: configuration.CHAIN_ENV,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [configuration.RPC_URL] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(configuration.RPC_URL),
  });
  const usdcAddress = getAddress(configuration.USDC_ADDRESS);
  const lendingContractAddress = getAddress(
    configuration.LENDING_CONTRACT_ADDRESS,
  );

  return {
    configuration,
    getChainId: () => client.getChainId(),
    getUsdcBalance: (account: Address) =>
      client.readContract({
        address: usdcAddress,
        abi: erc20UsdcAbi,
        functionName: "balanceOf",
        args: [account],
      }),
    readBasicContractState: async () => {
      const [decimals, configuredUsdc, authorizationSigner, nextOfferId] =
        await Promise.all([
          client.readContract({
            address: usdcAddress,
            abi: erc20UsdcAbi,
            functionName: "decimals",
          }),
          client.readContract({
            address: lendingContractAddress,
            abi: employeeLendingEscrowAbi,
            functionName: "usdc",
          }),
          client.readContract({
            address: lendingContractAddress,
            abi: employeeLendingEscrowAbi,
            functionName: "authorizationSigner",
          }),
          client.readContract({
            address: lendingContractAddress,
            abi: employeeLendingEscrowAbi,
            functionName: "nextOfferId",
          }),
        ]);

      return {
        decimals,
        configuredUsdc,
        authorizationSigner,
        nextOfferId,
      };
    },
  };
}
