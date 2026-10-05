import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { createPublicClient, http } from "viem";

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
      if ((await client.getChainId()) === 31_337) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the local Hardhat RPC endpoint.");
}

const port = await availablePort();
const rpcUrl = `http://127.0.0.1:${port}`;
const testDeploymentPath = path.join("cache", "local-chain-test.json");
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
  const deployment = JSON.parse(await readFile(testDeploymentPath, "utf8")) as {
    mockUsdc: string;
    lendingContract: string;
  };
  await run(process.execPath, [vitestCli, "run", "tests/local-chain.test.ts"], {
    ...environment,
    CHAIN_ENV: "local",
    CHAIN_ID: "31337",
    USDC_ADDRESS: deployment.mockUsdc,
    LENDING_CONTRACT_ADDRESS: deployment.lendingContract,
  });
} finally {
  node.kill();
}
