import { spawn } from "node:child_process";
import path from "node:path";

import {
  startManagedLocalChain,
  stopManagedLocalChain,
} from "./local-chain-process.js";

await stopManagedLocalChain();
await startManagedLocalChain();

const hardhatCli = path.join(
  process.cwd(),
  "node_modules",
  "hardhat",
  "dist",
  "src",
  "cli.js",
);
await new Promise<void>((resolve, reject) => {
  const deployment = spawn(
    process.execPath,
    [
      hardhatCli,
      "run",
      "--network",
      "localhost",
      "scripts/deploy-local-chain.ts",
    ],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  deployment.once("error", reject);
  deployment.once("exit", (code) =>
    code === 0
      ? resolve()
      : reject(new Error(`Local deployment exited with code ${code}.`)),
  );
});
