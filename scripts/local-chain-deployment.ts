import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { network } from "hardhat";

import {
  LOCAL_CHAIN_ID,
  LOCAL_DEPLOYMENT_PATH,
  LOCAL_RPC_URL,
} from "../src/integrations/blockchain/local-chain.js";

export const INITIAL_MOCK_USDC_BALANCE = 1_000_000n * 10n ** 6n;

export async function deployLocalChain() {
  const { networkName, provider, viem } = await network.create();
  if (networkName !== "localhost") {
    throw new Error("Local deployment must use --network localhost.");
  }

  const publicClient = await viem.getPublicClient();
  const [deployer, lender, borrower, authorizer] =
    await viem.getWalletClients();
  if (!deployer || !lender || !borrower || !authorizer) {
    throw new Error(
      "The local chain must expose at least four development accounts.",
    );
  }

  const chainId = await publicClient.getChainId();
  if (chainId !== LOCAL_CHAIN_ID) {
    throw new Error(
      `Refusing local deployment: expected chain ${LOCAL_CHAIN_ID}, received ${chainId}.`,
    );
  }
  const metadata = (await provider.request({
    method: "hardhat_metadata",
  })) as { instanceId?: unknown };
  if (typeof metadata.instanceId !== "string" || !metadata.instanceId) {
    throw new Error("The local Hardhat node did not provide an instance ID.");
  }

  const mockUsdc = await viem.deployContract("MockUSDC");
  await Promise.all(
    [deployer, lender, borrower].map(async (wallet) => {
      const hash = await mockUsdc.write.mint([
        wallet.account.address,
        INITIAL_MOCK_USDC_BALANCE,
      ]);
      await publicClient.waitForTransactionReceipt({ hash });
    }),
  );
  const lendingContract = await viem.deployContract("EmployeeLendingEscrow", [
    mockUsdc.address,
    authorizer.account.address,
  ]);

  const deployment = {
    environment: "local",
    chainId,
    chainInstanceId: metadata.instanceId,
    rpcUrl: process.env.LOCAL_RPC_URL ?? LOCAL_RPC_URL,
    mockUsdc: mockUsdc.address,
    lendingContract: lendingContract.address,
    authorizationSigner: authorizer.account.address,
    deployer: deployer.account.address,
    fundedAccounts: [
      deployer.account.address,
      lender.account.address,
      borrower.account.address,
    ],
    initialMockUsdcBalance: INITIAL_MOCK_USDC_BALANCE.toString(),
  } as const;

  const manifestPath = path.resolve(
    process.env.LOCAL_DEPLOYMENT_PATH ?? LOCAL_DEPLOYMENT_PATH,
  );
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(deployment, null, 2)}\n`,
    "utf8",
  );

  console.log("Local Chain Deployment");
  console.log("----------------------");
  console.log(`Chain ID: ${deployment.chainId}`);
  console.log(`Mock USDC: ${deployment.mockUsdc}`);
  console.log(`Lending Contract: ${deployment.lendingContract}`);
  console.log(`Authorization Signer: ${deployment.authorizationSigner}`);
  console.log(`Deployer: ${deployment.deployer}`);
  console.log(`Manifest: ${path.relative(process.cwd(), manifestPath)}`);

  return deployment;
}
