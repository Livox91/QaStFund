import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

import localChainConfig from "./local-chain.config.json" with { type: "json" };

const configuredLocalRpcUrl =
  process.env.LOCAL_RPC_URL ?? localChainConfig.rpcUrl;
const LOCAL_DEVELOPMENT_MNEMONIC =
  "test test test test test test test test test test test junk";

export default defineConfig({
  plugins: [hardhatToolboxViem],
  paths: { tests: { nodejs: "./contracts-test" } },
  solidity: {
    profiles: {
      default: { version: "0.8.28" },
      production: {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  networks: {
    hardhatLocal: {
      type: "edr-simulated",
      chainId: localChainConfig.chainId,
      accounts: {
        mnemonic: LOCAL_DEVELOPMENT_MNEMONIC,
        count: 20,
      },
    },
    localhost: {
      type: "http",
      chainId: localChainConfig.chainId,
      url: configuredLocalRpcUrl,
    },
    arcTestnet: {
      type: "http",
      chainId: 5_042_002,
      url: "https://rpc.testnet.arc.network",
      accounts: [configVariable("ARC_DEPLOYER_PRIVATE_KEY")],
    },
  },
});
