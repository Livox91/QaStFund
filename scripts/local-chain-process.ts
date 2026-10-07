import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { createPublicClient, http } from "viem";

import {
  LOCAL_CHAIN_ID,
  LOCAL_RPC_URL,
} from "../src/integrations/blockchain/local-chain.js";

const projectRoot = process.cwd();
const runtimeDirectory = path.join(projectRoot, "cache", "local-chain");
const pidPath = path.join(runtimeDirectory, "node.pid");
const logPath = path.join(runtimeDirectory, "node.log");
const hardhatCli = path.join(
  projectRoot,
  "node_modules",
  "hardhat",
  "dist",
  "src",
  "cli.js",
);
const rpcUrl = process.env.LOCAL_RPC_URL ?? LOCAL_RPC_URL;

async function getChainId(): Promise<number | null> {
  try {
    return await createPublicClient({ transport: http(rpcUrl) }).getChainId();
  } catch {
    return null;
  }
}

async function readManagedPid(): Promise<number | null> {
  try {
    const pid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function waitForChain(expectedReady: boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = (await getChainId()) === LOCAL_CHAIN_ID;
    if (ready === expectedReady) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    expectedReady
      ? `Timed out waiting for Hardhat at ${rpcUrl}. See ${logPath}.`
      : `Timed out waiting for Hardhat at ${rpcUrl} to stop.`,
  );
}

export async function startManagedLocalChain() {
  const existingChainId = await getChainId();
  if (existingChainId !== null) {
    if (existingChainId !== LOCAL_CHAIN_ID) {
      throw new Error(`${rpcUrl} is already serving chain ${existingChainId}.`);
    }
    console.log(`Local Hardhat chain is already running at ${rpcUrl}.`);
    return;
  }

  await mkdir(runtimeDirectory, { recursive: true });
  const log = openSync(logPath, "a");
  const child = spawn(
    process.execPath,
    [
      hardhatCli,
      "node",
      "--network",
      "hardhatLocal",
      "--hostname",
      "127.0.0.1",
      "--port",
      new URL(rpcUrl).port || "8545",
    ],
    {
      cwd: projectRoot,
      detached: true,
      env: process.env,
      stdio: ["ignore", log, log],
    },
  );
  closeSync(log);
  if (!child.pid) throw new Error("Hardhat did not return a process ID.");
  await writeFile(pidPath, String(child.pid), "utf8");
  child.unref();

  try {
    await waitForChain(true);
  } catch (error) {
    await rm(pidPath, { force: true });
    throw error;
  }
  console.log(`Local Hardhat chain started at ${rpcUrl} (PID ${child.pid}).`);
  console.log(`Logs: ${path.relative(projectRoot, logPath)}`);
}

export async function stopManagedLocalChain() {
  const pid = await readManagedPid();
  if (pid === null) {
    if ((await getChainId()) !== null) {
      throw new Error(
        `A chain is running at ${rpcUrl}, but it was not started by npm run chain:start. Stop it manually before resetting.`,
      );
    }
    console.log("No managed local Hardhat chain is running.");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  await waitForChain(false);
  await rm(pidPath, { force: true });
  console.log("Local Hardhat chain stopped.");
}
