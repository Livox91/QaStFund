import { describe, expect, it } from "vitest";

import {
  localChainEnvironment,
  parseLocalChainDeployment,
  validateLocalChainDeployment,
} from "@/integrations/blockchain/local-chain";

const manifest = parseLocalChainDeployment({
  environment: "local",
  chainId: 31_337,
  chainInstanceId: "instance-current",
  rpcUrl: "http://127.0.0.1:8545",
  mockUsdc: "0x0000000000000000000000000000000000000001",
  lendingContract: "0x0000000000000000000000000000000000000002",
  authorizationSigner: "0x0000000000000000000000000000000000000003",
  deployer: "0x0000000000000000000000000000000000000004",
  fundedAccounts: [
    "0x0000000000000000000000000000000000000004",
    "0x0000000000000000000000000000000000000005",
    "0x0000000000000000000000000000000000000006",
  ],
  initialMockUsdcBalance: "1000000000000",
});

describe("local-chain deployment manifest", () => {
  it("provides the application blockchain environment", () => {
    expect(localChainEnvironment(manifest)).toEqual({
      CHAIN_ENV: "local",
      RPC_URL: "http://127.0.0.1:8545",
      CHAIN_ID: "31337",
      USDC_ADDRESS: manifest.mockUsdc,
      LENDING_CONTRACT_ADDRESS: manifest.lendingContract,
    });
  });

  it("rejects a manifest from a previous Hardhat instance", () => {
    expect(() =>
      validateLocalChainDeployment(manifest, {
        rpcUrl: manifest.rpcUrl,
        chainInstanceId: "instance-new",
      }),
    ).toThrow("different Hardhat instance");
  });

  it("rejects a manifest for a different RPC endpoint", () => {
    expect(() =>
      validateLocalChainDeployment(manifest, {
        rpcUrl: "http://127.0.0.1:9545",
        chainInstanceId: manifest.chainInstanceId,
      }),
    ).toThrow("expected RPC");
  });
});
