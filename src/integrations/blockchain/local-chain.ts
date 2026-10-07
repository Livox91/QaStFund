import { z } from "zod";

import localChainConfig from "../../../local-chain.config.json" with { type: "json" };

export const LOCAL_CHAIN_ID = localChainConfig.chainId as 31_337;
export const LOCAL_RPC_URL = localChainConfig.rpcUrl;
export const LOCAL_DEPLOYMENT_PATH = "deployments/local.json" as const;

const addressSchema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value),
  "must be a 20-byte EVM address",
);

const localChainDeploymentSchema = z.object({
  environment: z.literal("local"),
  chainId: z.literal(LOCAL_CHAIN_ID),
  chainInstanceId: z.string().min(1),
  rpcUrl: z.url(),
  mockUsdc: addressSchema,
  lendingContract: addressSchema,
  authorizationSigner: addressSchema,
  deployer: addressSchema,
  fundedAccounts: z.array(addressSchema).min(3),
  initialMockUsdcBalance: z.string().regex(/^\d+$/),
});

export type LocalChainDeployment = z.infer<typeof localChainDeploymentSchema>;

export function parseLocalChainDeployment(
  value: unknown,
): LocalChainDeployment {
  const result = localChainDeploymentSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid local-chain deployment manifest:\n${result.error.issues
        .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  return result.data;
}

export function validateLocalChainDeployment(
  deployment: LocalChainDeployment,
  expected: { rpcUrl: string; chainInstanceId: string },
) {
  if (deployment.rpcUrl !== expected.rpcUrl) {
    throw new Error(
      `Stale local-chain deployment manifest: expected RPC ${expected.rpcUrl}, found ${deployment.rpcUrl}. Run npm run chain:test or npm run chain:reset.`,
    );
  }
  if (deployment.chainInstanceId !== expected.chainInstanceId) {
    throw new Error(
      "Stale local-chain deployment manifest: it belongs to a different Hardhat instance. Redeploy the contracts before continuing.",
    );
  }
}

export function localChainEnvironment(deployment: LocalChainDeployment) {
  return {
    CHAIN_ENV: deployment.environment,
    RPC_URL: deployment.rpcUrl,
    CHAIN_ID: String(deployment.chainId),
    USDC_ADDRESS: deployment.mockUsdc,
    LENDING_CONTRACT_ADDRESS: deployment.lendingContract,
  } as const;
}
