import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

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
    arcTestnet: {
      type: "http",
      chainId: 5_042_002,
      url: "https://rpc.testnet.arc.network",
      accounts: [configVariable("ARC_DEPLOYER_PRIVATE_KEY")],
    },
  },
});
