import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { createPublicClient, http } from "viem";

import {
  LOCAL_CHAIN_ID,
  localChainEnvironment,
  parseLocalChainDeployment,
  validateLocalChainDeployment,
} from "../src/integrations/blockchain/local-chain.js";

const projectRoot = process.cwd();
const hardhatCli = path.join(
  projectRoot,
  "node_modules",
  "hardhat",
  "dist",
  "src",
  "cli.js",
);
const vitestCli = path.join(
  projectRoot,
  "node_modules",
  "vitest",
  "vitest.mjs",
);
const prismaCli = path.join(
  projectRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js",
);

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a local port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`${path.basename(command)} exited with code ${code}.`),
          ),
    );
  });
}

async function waitForRpc(rpcUrl: string, node: ChildProcess) {
  const client = createPublicClient({ transport: http(rpcUrl) });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (node.exitCode !== null)
      throw new Error("Hardhat node exited before becoming ready.");
    try {
      if ((await client.getChainId()) === LOCAL_CHAIN_ID) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the local Hardhat RPC endpoint.");
}

async function getChainInstanceId(rpcUrl: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "hardhat_metadata",
      params: [],
    }),
  });
  const payload = (await response.json()) as {
    result?: { instanceId?: unknown };
  };
  if (typeof payload.result?.instanceId !== "string") {
    throw new Error("Hardhat RPC did not return a valid chain instance ID.");
  }
  return payload.result.instanceId;
}

async function terminate(node: ChildProcess) {
  if (node.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    node.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    node.kill();
  });
}

const port = await availablePort();
const rpcUrl = `http://127.0.0.1:${port}`;
const testDeploymentPath = path.join("cache", `local-chain-test-${port}.json`);
const environment = {
  ...process.env,
  LOCAL_RPC_URL: rpcUrl,
  RPC_URL: rpcUrl,
  LOCAL_DEPLOYMENT_PATH: testDeploymentPath,
};
const node = spawn(
  process.execPath,
  [
    hardhatCli,
    "node",
    "--network",
    "hardhatLocal",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { cwd: projectRoot, env: environment, stdio: "inherit" },
);

try {
  await rm(testDeploymentPath, { force: true });
  await waitForRpc(rpcUrl, node);
  await run(
    process.execPath,
    [
      hardhatCli,
      "run",
      "--network",
      "localhost",
      "scripts/deploy-local-chain.ts",
    ],
    environment,
  );
  const deployment = parseLocalChainDeployment(
    JSON.parse(await readFile(testDeploymentPath, "utf8")),
  );
  validateLocalChainDeployment(deployment, {
    rpcUrl,
    chainInstanceId: await getChainInstanceId(rpcUrl),
  });
  await run(process.execPath, [prismaCli, "migrate", "deploy"], environment);
  await run(
    process.execPath,
    [vitestCli, "run", "--config", "vitest.local-chain.config.mts"],
    {
      ...environment,
      ...localChainEnvironment(deployment),
      LOCAL_CHAIN_TEST_RUN: "1",
    },
  );
} finally {
  await terminate(node);
  await rm(testDeploymentPath, { force: true });
}
