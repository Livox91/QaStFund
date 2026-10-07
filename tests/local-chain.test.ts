import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";

import { parseBlockchainEnvironment } from "@/infrastructure/config/environment-schema";
import { createBlockchainReadClient } from "@/integrations/blockchain/blockchain-read-client";
import {
  LOCAL_CHAIN_ID,
  parseLocalChainDeployment,
  validateLocalChainDeployment,
} from "@/integrations/blockchain/local-chain";

if (process.env.LOCAL_CHAIN_TEST_RUN !== "1") {
  throw new Error(
    "Local-chain integration tests require the managed deployment workflow. Run `npm run chain:test` instead of invoking this file directly.",
  );
}

async function getChainInstanceId(rpcUrl: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "hardhat_metadata",
      params: [],
    }),
  });
  const payload = (await response.json()) as {
    result?: { instanceId?: unknown };
  };
  if (typeof payload.result?.instanceId !== "string") {
    throw new Error("The configured RPC is not a compatible Hardhat node.");
  }
  return payload.result.instanceId;
}

describe("local Hardhat chain", () => {
  it("connects through the backend client and matches the deployment manifest", async () => {
    const deploymentPath = process.env.LOCAL_DEPLOYMENT_PATH;
    if (!deploymentPath) {
      throw new Error(
        "LOCAL_DEPLOYMENT_PATH is missing. Run this test through `npm run chain:test`.",
      );
    }
    const deployment = parseLocalChainDeployment(
      JSON.parse(await readFile(deploymentPath, "utf8")),
    );
    const configuration = parseBlockchainEnvironment(process.env);
    const client = createBlockchainReadClient(configuration);
    validateLocalChainDeployment(deployment, {
      rpcUrl: configuration.RPC_URL,
      chainInstanceId: await getChainInstanceId(configuration.RPC_URL),
    });

    expect(await client.getChainId()).toBe(LOCAL_CHAIN_ID);
    expect(configuration.CHAIN_ID).toBe(deployment.chainId);
    expect(configuration.USDC_ADDRESS.toLowerCase()).toBe(
      deployment.mockUsdc.toLowerCase(),
    );
    expect(configuration.LENDING_CONTRACT_ADDRESS.toLowerCase()).toBe(
      deployment.lendingContract.toLowerCase(),
    );

    const publicClient = createPublicClient({
      transport: http(configuration.RPC_URL),
    });
    const [mockUsdcCode, lendingContractCode] = await Promise.all([
      publicClient.getCode({ address: deployment.mockUsdc }),
      publicClient.getCode({ address: deployment.lendingContract }),
    ]);
    expect(mockUsdcCode).toBeDefined();
    expect(mockUsdcCode).not.toBe("0x");
    expect(lendingContractCode).toBeDefined();
    expect(lendingContractCode).not.toBe("0x");

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
