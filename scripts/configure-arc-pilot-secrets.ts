import "dotenv/config";

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { privateKeyToAccount } from "viem/accounts";

const environmentPath = resolve(process.cwd(), ".env");
let contents = await readFile(environmentPath, "utf8");

function configuredValue(name: string): string | undefined {
  const match = contents.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!match) return undefined;
  return match[1].trim().replace(/^(["'])(.*)\1$/, "$2") || undefined;
}

function setValue(name: string, value: string): void {
  const line = `${name}="${value}"`;
  const expression = new RegExp(`^${name}=.*$`, "m");
  contents = expression.test(contents)
    ? contents.replace(expression, line)
    : `${contents.trimEnd()}\n${line}\n`;
}

function createPrivateKey(): `0x${string}` {
  while (true) {
    const candidate = `0x${randomBytes(32).toString("hex")}` as const;
    try {
      privateKeyToAccount(candidate);
      return candidate;
    } catch {
      // The secp256k1 range excludes a negligible subset of 32-byte values.
    }
  }
}

const authorizerKey =
  configuredValue("ARC_BORROW_AUTHORIZER_PRIVATE_KEY") ?? createPrivateKey();
const deployerKey =
  configuredValue("ARC_DEPLOYER_PRIVATE_KEY") ?? createPrivateKey();
const authorizer = privateKeyToAccount(authorizerKey as `0x${string}`);
const deployer = privateKeyToAccount(deployerKey as `0x${string}`);

setValue("ARC_BORROW_AUTHORIZER_PRIVATE_KEY", authorizerKey);
setValue("ARC_BORROW_AUTHORIZER_ADDRESS", authorizer.address);
setValue("ARC_DEPLOYER_PRIVATE_KEY", deployerKey);
setValue(
  "ARC_RECONCILIATION_CRON_SECRET",
  configuredValue("ARC_RECONCILIATION_CRON_SECRET") ??
    randomBytes(48).toString("base64url"),
);
setValue(
  "RATE_LIMIT_HASH_SECRET",
  configuredValue("RATE_LIMIT_HASH_SECRET") ??
    randomBytes(48).toString("base64url"),
);
setValue("ERP_NEXT_SYNC_ENABLED", "false");

await writeFile(environmentPath, contents, { encoding: "utf8", mode: 0o600 });

console.log(
  "Arc pilot server-side secrets are configured in the ignored .env file.",
);
console.log(`Borrow authorizer address: ${authorizer.address}`);
console.log(`Deployment wallet address: ${deployer.address}`);
console.log("No private keys or secret values were printed.");
