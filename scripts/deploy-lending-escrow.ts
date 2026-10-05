import "dotenv/config";

import { network } from "hardhat";
import { getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_USDC_ADDRESS,
} from "../src/integrations/arc/arc-testnet.js";

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

const authorizerPrivateKey = process.env.ARC_BORROW_AUTHORIZER_PRIVATE_KEY;
if (!authorizerPrivateKey?.match(/^0x[0-9a-fA-F]{64}$/)) {
  throw new Error(
    "ARC_BORROW_AUTHORIZER_PRIVATE_KEY must be a 32-byte private key.",
  );
}
const derivedAuthorizationSigner = privateKeyToAccount(
  authorizerPrivateKey as `0x${string}`,
).address;
if (derivedAuthorizationSigner !== authorizationSigner) {
  throw new Error(
    "ARC_BORROW_AUTHORIZER_ADDRESS does not match the configured private key.",
  );
}

const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
if (chainId !== ARC_TESTNET_CHAIN_ID) {
  throw new Error(
    `Refusing deployment: expected Arc Testnet chain ${ARC_TESTNET_CHAIN_ID}, received ${chainId}.`,
  );
}
const usdcCode = await publicClient.getCode({ address: ARC_USDC_ADDRESS });
if (!usdcCode || usdcCode === "0x") {
  throw new Error("Canonical Arc Testnet USDC contract is not accessible.");
}

const { contract: escrow, deploymentTransaction } =
  await viem.sendDeploymentTransaction("EmployeeLendingEscrow", [
    ARC_USDC_ADDRESS,
    authorizationSigner,
  ]);
const receipt = await publicClient.waitForTransactionReceipt({
  hash: deploymentTransaction.hash,
  confirmations: 1,
});
if (
  receipt.status !== "success" ||
  receipt.contractAddress?.toLowerCase() !== escrow.address.toLowerCase()
) {
  throw new Error("Escrow deployment transaction did not succeed.");
}
const [configuredSigner, configuredUsdc] = await Promise.all([
  escrow.read.authorizationSigner(),
  escrow.read.usdc(),
]);
if (
  configuredSigner.toLowerCase() !== authorizationSigner.toLowerCase() ||
  configuredUsdc.toLowerCase() !== getAddress(ARC_USDC_ADDRESS).toLowerCase()
) {
  throw new Error("Deployed escrow constructor configuration is invalid.");
}

console.log(`EmployeeLendingEscrow deployed to ${escrow.address}`);
console.log(`Deployment transaction hash: ${deploymentTransaction.hash}`);
console.log(`Deployment block number: ${receipt.blockNumber}`);
console.log(`Chain ID: ${chainId}`);
console.log(`authorizationSigner(): ${configuredSigner}`);
console.log(`usdc(): ${configuredUsdc}`);
console.log(`NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS=${escrow.address}`);
console.log(`ARC_RECONCILIATION_START_BLOCK=${receipt.blockNumber}`);
console.log(
  `ARC_ESCROW_DEPLOYMENT_TRANSACTION_HASH=${deploymentTransaction.hash}`,
);
