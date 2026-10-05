import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseBlockchainEnvironment } from "@/infrastructure/config/environment-schema";
import { createBlockchainReadClient } from "@/integrations/blockchain/blockchain-read-client";

interface LocalDeployment {
  chainId: number;
  mockUsdc: `0x${string}`;
  lendingContract: `0x${string}`;
  authorizationSigner: `0x${string}`;
  fundedAccounts: `0x${string}`[];
  initialMockUsdcBalance: string;
}

describe("local Hardhat chain", () => {
  it("connects through the backend client and matches the deployment manifest", async () => {
    const deployment = JSON.parse(
      await readFile(
        process.env.LOCAL_DEPLOYMENT_PATH ?? "deployments/local.json",
        "utf8",
      ),
    ) as LocalDeployment;
    const configuration = parseBlockchainEnvironment(process.env);
    const client = createBlockchainReadClient(configuration);

    expect(await client.getChainId()).toBe(31_337);
    expect(configuration.CHAIN_ID).toBe(deployment.chainId);
    expect(configuration.USDC_ADDRESS.toLowerCase()).toBe(
      deployment.mockUsdc.toLowerCase(),
    );
    expect(configuration.LENDING_CONTRACT_ADDRESS.toLowerCase()).toBe(
      deployment.lendingContract.toLowerCase(),
    );

    const state = await client.readBasicContractState();
    expect(state.decimals).toBe(6);
    expect(state.configuredUsdc.toLowerCase()).toBe(
      deployment.mockUsdc.toLowerCase(),
    );
    expect(state.authorizationSigner.toLowerCase()).toBe(
      deployment.authorizationSigner.toLowerCase(),
    );
    expect(state.nextOfferId).toBe(1n);
    expect(await client.getUsdcBalance(deployment.fundedAccounts[1])).toBe(
      BigInt(deployment.initialMockUsdcBalance),
    );
  });
});
