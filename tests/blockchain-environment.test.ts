import { describe, expect, it } from "vitest";

import { parseBlockchainEnvironment } from "@/infrastructure/config/environment-schema";

const addresses = {
  USDC_ADDRESS: "0x0000000000000000000000000000000000000001",
  LENDING_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000002",
};

describe("blockchain environment", () => {
  it.each([
    ["local", "31337"],
    ["testnet", "5042002"],
    ["production", "1"],
  ] as const)("supports the %s environment", (chainEnvironment, chainId) => {
    expect(
      parseBlockchainEnvironment({
        CHAIN_ENV: chainEnvironment,
        CHAIN_ID: chainId,
        RPC_URL: "http://127.0.0.1:8545",
        ...addresses,
      }),
    ).toMatchObject({
      CHAIN_ENV: chainEnvironment,
      CHAIN_ID: Number(chainId),
    });
  });

  it("rejects a mismatched local chain ID", () => {
    expect(() =>
      parseBlockchainEnvironment({
        CHAIN_ENV: "local",
        CHAIN_ID: "1",
        RPC_URL: "http://127.0.0.1:8545",
        ...addresses,
      }),
    ).toThrow("CHAIN_ID must be 31337");
  });
});
