import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

const LOCAL_CHAIN_ID = 31_337;
const LOCAL_RPC_URL = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
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
      chainId: LOCAL_CHAIN_ID,
      accounts: {
        mnemonic: LOCAL_DEVELOPMENT_MNEMONIC,
        count: 20,
      },
    },
    localhost: {
      type: "http",
      chainId: LOCAL_CHAIN_ID,
      url: LOCAL_RPC_URL,
    },
    arcTestnet: {
      type: "http",
      chainId: 5_042_002,
      url: "https://rpc.testnet.arc.network",
      accounts: [configVariable("ARC_DEPLOYER_PRIVATE_KEY")],
    },
  },
});
