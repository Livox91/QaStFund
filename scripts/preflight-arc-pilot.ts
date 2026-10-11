import "dotenv/config";

import {
  createPublicClient,
  formatUnits,
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
  ARC_NATIVE_USDC_DECIMALS,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_USDC_ADDRESS,
  arcTestnet,
  getArcModularClientUrl,
} from "@/integrations/arc/arc-testnet";
import {
  employeeLendingEscrowAbi,
  erc20UsdcAbi,
} from "@/integrations/arc/employee-lending-escrow";
import {
  inspectPilotWalletBalances,
  inspectPilotWalletRecords,
  MIN_PILOT_NATIVE_FEE_BALANCE,
  MIN_PILOT_USDC_BALANCE,
  type PilotWalletBalance,
} from "@/modules/arc-wallet/application/arc-pilot-readiness";
import {
  getReconciliationCatchUpIssue,
  getReconciliationPreflightIssues,
} from "@/modules/blockchain-reconciliation/application/preflight-readiness";
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
  if (!deploymentBlock || !latestBlock) {
    throw new Error("deployment block and RPC checks did not pass");
  }
  const cronSecret = strongSecret("ARC_RECONCILIATION_CRON_SECRET");
  const issues = getReconciliationPreflightIssues({
    enabled: process.env.ARC_RECONCILIATION_ENABLED === "true",
    rpcUrl: required("ARC_RECONCILIATION_RPC_URL"),
    expectedRpcUrl: ARC_TESTNET_RPC_URL,
    startBlock: deploymentBlock,
    latestBlock,
    cronSecret,
  });
  if (issues.length > 0) throw new Error(issues.join("; "));
  return `enabled from block ${deploymentBlock}`;
});

await check("Reconciliation health (read-only)", async () => {
  if (!contractAddress || !deploymentBlock || !latestBlock) {
    throw new Error(
      "reconciliation, deployment block, and RPC checks must pass first",
    );
  }
  const health = await getConfiguredDependencyHealth();
  if (health.dependencies.arc.status !== "healthy") {
    throw new Error("Arc dependency health is not healthy");
  }
  if (health.dependencies.reconciliation.status !== "healthy") {
    throw new Error(
      `reconciliation is ${health.dependencies.reconciliation.status}; run npm run reconcile:arc explicitly after reviewing its database-write behavior`,
    );
  }
  const reconciliation = health.dependencies.reconciliation;
  const catchUpIssue = getReconciliationCatchUpIssue({
    cursorNextBlock:
      "reconciliationCursor" in reconciliation
        ? (reconciliation.reconciliationCursor ?? null)
        : null,
    latestBlock,
    confirmationDepth: Number(required("ARC_RECONCILIATION_CONFIRMATIONS")),
    blockRange: Number(required("ARC_RECONCILIATION_BLOCK_RANGE")),
  });
  if (catchUpIssue) throw new Error(catchUpIssue);
  return "enabled with a healthy persisted cursor; no reconciliation pass was started by preflight";
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

let pilotWalletInspection:
  ReturnType<typeof inspectPilotWalletRecords> | undefined;

await check("Distinct active Circle pilot wallets", async () => {
  const [wallets, consumedChallenges] = await Promise.all([
    prisma.arcWallet.findMany({
      where: { network: "ARC_TESTNET" },
      select: {
        userId: true,
        address: true,
        status: true,
        enrollmentState: true,
      },
    }),
    prisma.arcWalletChallenge.findMany({
      where: { consumedAt: { not: null } },
      select: {
        organizationId: true,
        userId: true,
        address: true,
        consumedAt: true,
      },
    }),
  ]);
  pilotWalletInspection = inspectPilotWalletRecords(
    wallets,
    consumedChallenges,
  );
  if (pilotWalletInspection.duplicateAddresses.length > 0) {
    throw new Error(
      `duplicate ownership detected for ${pilotWalletInspection.duplicateAddresses.join(", ")}`,
    );
  }
  const users = new Set(
    pilotWalletInspection.activeWallets.map((wallet) => wallet.userId),
  );
  const addresses = new Set(
    pilotWalletInspection.activeWallets.map((wallet) =>
      wallet.address.toLowerCase(),
    ),
  );
  if (users.size < 2 || addresses.size < 2) {
    throw new Error(
      `need two distinct active wallets; found ${users.size} users and ${addresses.size} addresses`,
    );
  }
  return `${users.size} distinct users and ${addresses.size} distinct active addresses`;
});

await check("Circle wallet ownership verification", () => {
  if (!pilotWalletInspection) {
    throw new Error("wallet records could not be inspected");
  }
  if (pilotWalletInspection.verifiedWallets.length < 2) {
    throw new Error(
      `need two exact user/address ownership proofs; found ${pilotWalletInspection.verifiedWallets.length} verified and ${pilotWalletInspection.unverifiedWallets.length} unverified active wallets`,
    );
  }
  return `${pilotWalletInspection.verifiedWallets.length} active wallets have consumed, exact-match ownership challenges`;
});

let pilotWalletBalances: PilotWalletBalance[] | undefined;

await check("Pilot wallet ERC-20 USDC balances", async () => {
  if (!rpcClient || !pilotWalletInspection) {
    throw new Error("RPC and wallet record checks must pass first");
  }
  if (pilotWalletInspection.verifiedWallets.length < 2) {
    throw new Error(
      "two ownership-verified wallets are required before balances can be checked",
    );
  }
  pilotWalletBalances = await Promise.all(
    pilotWalletInspection.verifiedWallets.map(async (wallet) => ({
      ...wallet,
      usdcBalance: await rpcClient!.readContract({
        address: ARC_USDC_ADDRESS,
        abi: erc20UsdcAbi,
        functionName: "balanceOf",
        args: [wallet.address],
      }),
      nativeFeeBalance: await rpcClient!.getBalance({
        address: wallet.address,
      }),
    })),
  );
  const readiness = inspectPilotWalletBalances(pilotWalletBalances);
  if (readiness.sufficientUsdc.length < 2) {
    const observed = pilotWalletBalances
      .map(
        (wallet) =>
          `${wallet.address}=${formatUnits(wallet.usdcBalance, 6)} USDC`,
      )
      .join(", ");
    throw new Error(
      `need two wallets with at least ${formatUnits(MIN_PILOT_USDC_BALANCE, 6)} ERC-20 USDC; observed ${observed}`,
    );
  }
  return readiness.sufficientUsdc
    .map(
      (wallet) =>
        `${wallet.address}=${formatUnits(wallet.usdcBalance, 6)} USDC`,
    )
    .join(", ");
});

await check("Pilot wallet native fee balances", () => {
  if (!pilotWalletBalances) {
    throw new Error("wallet balances could not be read");
  }
  const readiness = inspectPilotWalletBalances(pilotWalletBalances);
  if (readiness.sufficientNativeFees.length < 2) {
    const observed = pilotWalletBalances
      .map(
        (wallet) =>
          `${wallet.address}=${formatUnits(wallet.nativeFeeBalance, ARC_NATIVE_USDC_DECIMALS)} native USDC`,
      )
      .join(", ");
    throw new Error(
      `need two wallets with a non-zero native fee balance (minimum ${MIN_PILOT_NATIVE_FEE_BALANCE} base unit); observed ${observed}`,
    );
  }
  if (readiness.readyWallets.length < 2) {
    throw new Error(
      "token and native fee balances are not sufficient on the same two wallets",
    );
  }
  return readiness.sufficientNativeFees
    .map(
      (wallet) =>
        `${wallet.address}=${formatUnits(wallet.nativeFeeBalance, ARC_NATIVE_USDC_DECIMALS)} native USDC`,
    )
    .join(", ");
});

await check("ERPNext eligibility source", async () => {
  const environment = validateEnvironment();
  const enabledOrganizations = await prisma.organization.count({
    where: { erpNextEnabled: true },
  });
  if (enabledOrganizations === 0) {
    if (environment.ERP_NEXT_SYNC_ENABLED) {
      throw new Error(
        "ERPNext scheduling is enabled but no organization uses it",
      );
    }
    return "DISABLED";
  }
  if (!environment.ERP_NEXT_SYNC_ENABLED) {
    throw new Error(
      `ERPNext is required by ${enabledOrganizations} organization(s), but scheduled synchronization is disabled`,
    );
  }
  strongSecret("ERP_NEXT_SYNC_CRON_SECRET");
  const staleBefore = new Date(
    Date.now() - environment.ERP_NEXT_ELIGIBILITY_MAX_AGE_MINUTES * 60_000,
  );
  const healthyIntegrations = await prisma.employeeDirectoryIntegration.count({
    where: {
      organization: { erpNextEnabled: true },
      lastSyncStatus: "SUCCESS",
      lastSuccessfulSyncAt: { gte: staleBefore },
    },
  });
  if (healthyIntegrations !== enabledOrganizations) {
    throw new Error(
      `complete, fresh ERPNext sync required for every enabled organization (${healthyIntegrations}/${enabledOrganizations} healthy)`,
    );
  }
  return `${healthyIntegrations}/${enabledOrganizations} complete and fresh`;
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
