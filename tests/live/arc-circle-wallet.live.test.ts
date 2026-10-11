import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Address,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_USDC_ADDRESS,
  arcTestnet,
  getArcModularClientUrl,
} from "@/integrations/arc/arc-testnet";
import { employeeLendingEscrowAbi } from "@/integrations/arc/employee-lending-escrow";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live Arc test`);
  return value;
}

function requiredAddress(name: string): Address {
  const value = required(name);
  if (!isAddress(value)) throw new Error(`${name} must be an EVM address`);
  return getAddress(value);
}

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC_URL, { retryCount: 2, timeout: 15_000 }),
});

describe("live Circle Modular Wallet and Arc Testnet configuration", () => {
  it("authenticates the configured Circle client key against Arc Testnet", async () => {
    const clientUrl = required("NEXT_PUBLIC_CIRCLE_CLIENT_URL");
    const response = await fetch(getArcModularClientUrl(clientUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${required("NEXT_PUBLIC_CIRCLE_CLIENT_KEY")}`,
        "Content-Type": "application/json",
        "X-AppInfo": `platform=web;version=live-test;uri=${new URL(required("APP_URL")).hostname}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    });
    const payload = (await response.json()) as {
      result?: string;
      error?: { message?: string };
    };

    expect(response.ok, payload.error?.message).toBe(true);
    expect(payload.result).toBe(`0x${ARC_TESTNET_CHAIN_ID.toString(16)}`);
  });

  it("matches the official Arc chain, USDC, escrow, and signer bindings", async () => {
    expect(Number(required("ARC_CHAIN_ID"))).toBe(ARC_TESTNET_CHAIN_ID);
    expect(required("ARC_RPC_URL")).toBe(ARC_TESTNET_RPC_URL);
    expect(requiredAddress("ARC_USDC_ADDRESS")).toBe(
      getAddress(ARC_USDC_ADDRESS),
    );

    const escrow = requiredAddress("NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS");
    const expectedSigner = requiredAddress("ARC_BORROW_AUTHORIZER_ADDRESS");
    const [chainId, usdcCode, escrowCode, contractUsdc, contractSigner] =
      await Promise.all([
        client.getChainId(),
        client.getCode({ address: ARC_USDC_ADDRESS }),
        client.getCode({ address: escrow }),
        client.readContract({
          address: escrow,
          abi: employeeLendingEscrowAbi,
          functionName: "usdc",
        }),
        client.readContract({
          address: escrow,
          abi: employeeLendingEscrowAbi,
          functionName: "authorizationSigner",
        }),
      ]);

    expect(chainId).toBe(ARC_TESTNET_CHAIN_ID);
    expect(usdcCode).not.toBe("0x");
    expect(escrowCode).not.toBe("0x");
    expect(contractUsdc).toBe(getAddress(ARC_USDC_ADDRESS));
    expect(contractSigner).toBe(expectedSigner);
  });
});
