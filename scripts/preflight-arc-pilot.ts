import "dotenv/config";

import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { validateEnvironment } from "@/infrastructure/config/environment";
import { prisma } from "@/infrastructure/database/prisma";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_USDC_ADDRESS,
  arcTestnet,
  getArcModularClientUrl,
} from "@/integrations/arc/arc-testnet";
import { employeeLendingEscrowAbi } from "@/integrations/arc/employee-lending-escrow";
import { runConfiguredArcReconciliation } from "@/modules/blockchain-reconciliation/index.server";
import { getConfiguredDependencyHealth } from "@/server/application/health/get-configured-dependency-health";

type CheckResult = Readonly<{
  label: string;
  passed: boolean;
  detail: string;
}>;

const results: CheckResult[] = [];

async function check(
  label: string,
  operation: () => string | Promise<string>,
): Promise<void> {
  try {
    results.push({ label, passed: true, detail: await operation() });
  } catch (cause) {
    results.push({
      label,
      passed: false,
      detail: cause instanceof Error ? cause.message : "Unknown failure",
    });
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function strongSecret(name: string): string {
  const value = required(name);
  if (value.length < 32 || new Set(value).size < 12) {
    throw new Error(`${name} is not sufficiently strong`);
  }
  if (
    value === process.env.DATABASE_URL ||
    /^(change|replace|example)/i.test(value)
  ) {
    throw new Error(`${name} uses a predictable value`);
  }
  return value;
}

function address(name: string): Address {
  const value = required(name);
  if (!isAddress(value)) throw new Error(`${name} is not a valid EVM address`);
  return getAddress(value);
}

console.log("Arc Testnet Pilot Preflight\n");

let rpcClient: ReturnType<typeof createPublicClient> | undefined;
let contractAddress: Address | undefined;
let latestBlock: bigint | undefined;
let deploymentBlock: bigint | undefined;
let contractSigner: Address | undefined;

await check("Environment configuration", () => {
  validateEnvironment();
  return "base server environment is valid";
});

await check("Chain ID", () => {
  const configured = Number(required("ARC_CHAIN_ID"));
  if (configured !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(`expected ${ARC_TESTNET_CHAIN_ID}, received ${configured}`);
  }
  return String(configured);
});

await check("RPC", async () => {
  const rpcUrl = required("ARC_RPC_URL");
  if (rpcUrl !== ARC_TESTNET_RPC_URL) {
    throw new Error(
      `expected the intended Arc Testnet RPC ${ARC_TESTNET_RPC_URL}`,
    );
  }
  rpcClient = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl, { retryCount: 1, timeout: 10_000 }),
  });
  const [chainId, block] = await Promise.all([
    rpcClient.getChainId(),
    rpcClient.getBlockNumber(),
  ]);
  if (chainId !== ARC_TESTNET_CHAIN_ID) {
    throw new Error(`RPC returned unexpected chain ${chainId}`);
  }
  latestBlock = block;
  return `connected at block ${block}`;
});

await check("USDC", async () => {
  if (!rpcClient) throw new Error("RPC check did not pass");
  const configured = address("ARC_USDC_ADDRESS");
  if (configured !== getAddress(ARC_USDC_ADDRESS)) {
    throw new Error(`expected canonical Arc Testnet USDC ${ARC_USDC_ADDRESS}`);
  }
  const code = await rpcClient.getCode({ address: configured });
  if (!code || code === "0x") throw new Error("USDC contract has no code");
  return configured;
});

await check("Escrow contract", async () => {
  if (!rpcClient) throw new Error("RPC check did not pass");
  contractAddress = address("NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS");
  const code = await rpcClient.getCode({ address: contractAddress });
  if (!code || code === "0x") throw new Error("escrow contract has no code");
  return contractAddress;
});

await check("Deployment block", async () => {
  if (!rpcClient || !latestBlock || !contractAddress) {
    throw new Error("RPC and escrow checks must pass first");
  }
  const raw = required("ARC_RECONCILIATION_START_BLOCK");
  if (!/^\d+$/.test(raw)) throw new Error("deployment block is not an integer");
  deploymentBlock = BigInt(raw);
  if (deploymentBlock <= 0n || deploymentBlock > latestBlock) {
    throw new Error("deployment block is outside the current Arc chain");
  }
  const code = await rpcClient.getCode({
    address: contractAddress,
    blockNumber: deploymentBlock,
  });
  if (!code || code === "0x") {
    throw new Error("escrow code is absent at the configured deployment block");
  }
  const transactionHash = process.env.ARC_ESCROW_DEPLOYMENT_TRANSACTION_HASH;
  if (transactionHash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
      throw new Error("deployment transaction hash is invalid");
    }
    const receipt = await rpcClient.getTransactionReceipt({
      hash: transactionHash as Hex,
    });
    if (
      receipt.status !== "success" ||
      receipt.blockNumber !== deploymentBlock ||
      receipt.contractAddress?.toLowerCase() !== contractAddress.toLowerCase()
    ) {
      throw new Error("deployment receipt does not match escrow configuration");
    }
  }
  return `${deploymentBlock}${transactionHash ? " (receipt verified)" : ""}`;
});

await check("Authorization signer", async () => {
  if (!rpcClient || !contractAddress) {
    throw new Error("RPC and escrow checks must pass first");
  }
  const privateKey = required("ARC_BORROW_AUTHORIZER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("server signer is not a 32-byte private key");
  }
  const derived = privateKeyToAccount(privateKey as Hex).address;
  contractSigner = await rpcClient.readContract({
    address: contractAddress,
    abi: employeeLendingEscrowAbi,
    functionName: "authorizationSigner",
  });
  const configuredPublic = process.env.ARC_BORROW_AUTHORIZER_ADDRESS
    ? address("ARC_BORROW_AUTHORIZER_ADDRESS")
    : derived;
  if (derived !== configuredPublic || derived !== contractSigner) {
    throw new Error(
      `server-derived ${derived}; contract ${contractSigner}; mismatch`,
    );
  }
  return `configured; server-derived ${derived}; contract ${contractSigner}; match`;
});

await check("Escrow USDC binding", async () => {
  if (!rpcClient || !contractAddress) {
    throw new Error("RPC and escrow checks must pass first");
  }
  const configuredUsdc = await rpcClient.readContract({
    address: contractAddress,
    abi: employeeLendingEscrowAbi,
    functionName: "usdc",
  });
  if (configuredUsdc !== getAddress(ARC_USDC_ADDRESS)) {
    throw new Error(`contract uses unexpected USDC ${configuredUsdc}`);
  }
  return configuredUsdc;
});

await check("Reconciliation configuration", () => {
  if (process.env.ARC_RECONCILIATION_ENABLED !== "true") {
    throw new Error("ARC_RECONCILIATION_ENABLED must be explicitly true");
  }
  if (required("ARC_RECONCILIATION_RPC_URL") !== ARC_TESTNET_RPC_URL) {
    throw new Error("reconciliation RPC is not the intended Arc Testnet RPC");
  }
  strongSecret("ARC_RECONCILIATION_CRON_SECRET");
  if (!deploymentBlock) throw new Error("deployment block check did not pass");
  return `enabled from block ${deploymentBlock}`;
});

await check("Reconciliation health", async () => {
  if (!contractAddress || !deploymentBlock) {
    throw new Error("reconciliation prerequisites did not pass");
  }
  await runConfiguredArcReconciliation();
  const health = await getConfiguredDependencyHealth();
  if (health.dependencies.arc.status !== "healthy") {
    throw new Error("Arc dependency health is not healthy");
  }
  if (health.dependencies.reconciliation.status !== "healthy") {
    throw new Error(
      `reconciliation is ${health.dependencies.reconciliation.status}`,
    );
  }
  return "enabled and healthy";
});

await check("Circle configuration", async () => {
  const clientKey = required("NEXT_PUBLIC_CIRCLE_CLIENT_KEY");
  const clientUrl = new URL(required("NEXT_PUBLIC_CIRCLE_CLIENT_URL"));
  const response = await fetch(getArcModularClientUrl(clientUrl.toString()), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clientKey}`,
      "Content-Type": "application/json",
      "X-AppInfo": `platform=web;version=preflight;uri=${new URL(required("APP_URL")).hostname}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    }),
  });
  if (!response.ok)
    throw new Error(`Circle RPC returned HTTP ${response.status}`);
  const payload = (await response.json()) as {
    result?: string;
    error?: unknown;
  };
  if (payload.result !== `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`) {
    throw new Error("Circle RPC did not return the Arc Testnet chain ID");
  }
  return "credentials accepted by Circle Arc RPC";
});

await check("Circle pilot wallets", async () => {
  const [wallets, consumedChallenges] = await Promise.all([
    prisma.arcWallet.findMany({
      where: { status: "ACTIVE", network: "ARC_TESTNET" },
      select: { userId: true, address: true },
    }),
    prisma.arcWalletChallenge.findMany({
      where: { consumedAt: { not: null } },
      select: { userId: true, address: true },
    }),
  ]);
  const users = new Set(wallets.map((wallet) => wallet.userId));
  const addresses = new Set(
    wallets.flatMap((wallet) =>
      wallet.address ? [wallet.address.toLowerCase()] : [],
    ),
  );
  const verifiedUsers = new Set(
    consumedChallenges
      .filter(
        (challenge) =>
          users.has(challenge.userId) &&
          addresses.has(challenge.address.toLowerCase()),
      )
      .map((challenge) => challenge.userId),
  );
  if (users.size < 2 || addresses.size < 2 || verifiedUsers.size < 2) {
    throw new Error(
      `need two distinct ownership-verified active wallets; found ${users.size} users, ${addresses.size} addresses, and ${verifiedUsers.size} verified users`,
    );
  }
  return `${verifiedUsers.size} distinct users with ownership-verified, distinct wallet addresses`;
});

await check("ERPNext disabled", () => {
  if (process.env.ERP_NEXT_SYNC_ENABLED !== "false") {
    throw new Error(
      "ERP_NEXT_SYNC_ENABLED must be explicitly false for this pilot",
    );
  }
  return "DISABLED";
});

await check("Rate-limit secret", () => {
  strongSecret("RATE_LIMIT_HASH_SECRET");
  return "configured and sufficiently strong";
});

await check("Database", async () => {
  await prisma.$queryRaw`SELECT 1`;
  return "connected";
});

await prisma.$disconnect();

for (const result of results) {
  console.log(
    `[${result.passed ? "PASS" : "FAIL"}] ${result.label}: ${result.detail}`,
  );
}

const ready = results.every((result) => result.passed);
console.log(
  `\nRESULT: ${ready ? "READY FOR CONTROLLED ARC TESTNET PILOT" : "NOT READY FOR PILOT"}`,
);
if (!ready) process.exitCode = 1;
