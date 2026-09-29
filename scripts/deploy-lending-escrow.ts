import { network } from "hardhat";

import { ARC_USDC_ADDRESS } from "../src/integrations/arc/arc-testnet.js";

const { networkName, viem } = await network.create();
if (networkName !== "arcTestnet") {
  throw new Error(
    "Deploy EmployeeLendingEscrow only with --network arcTestnet.",
  );
}

const escrow = await viem.deployContract("EmployeeLendingEscrow", [
  ARC_USDC_ADDRESS,
]);

console.log(`EmployeeLendingEscrow deployed to ${escrow.address}`);
console.log(
  `Set NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS=${escrow.address} and restart the app.`,
);
