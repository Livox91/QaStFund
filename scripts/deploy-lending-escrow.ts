import "dotenv/config";

import { network } from "hardhat";
import { getAddress, isAddress } from "viem";

import { ARC_USDC_ADDRESS } from "../src/integrations/arc/arc-testnet.js";

const { networkName, viem } = await network.create();
if (networkName !== "arcTestnet") {
  throw new Error(
    "Deploy EmployeeLendingEscrow only with --network arcTestnet.",
  );
}

const configuredAuthorizer = process.env.ARC_BORROW_AUTHORIZER_ADDRESS;
if (!configuredAuthorizer || !isAddress(configuredAuthorizer)) {
  throw new Error(
    "ARC_BORROW_AUTHORIZER_ADDRESS must be a valid non-zero address.",
  );
}
const authorizationSigner = getAddress(configuredAuthorizer);
if (authorizationSigner === "0x0000000000000000000000000000000000000000") {
  throw new Error(
    "ARC_BORROW_AUTHORIZER_ADDRESS must not be the zero address.",
  );
}

const escrow = await viem.deployContract("EmployeeLendingEscrow", [
  ARC_USDC_ADDRESS,
  authorizationSigner,
]);

console.log(`EmployeeLendingEscrow deployed to ${escrow.address}`);
console.log(`Borrow authorization signer: ${authorizationSigner}`);
console.log(
  `Set NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS=${escrow.address} and restart the app.`,
);
