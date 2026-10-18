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

function createPrivateKey(excludedKey?: string): `0x${string}` {
  while (true) {
    const candidate = `0x${randomBytes(32).toString("hex")}` as const;
    if (candidate.toLowerCase() === excludedKey?.toLowerCase()) continue;
    try {
      privateKeyToAccount(candidate);
      return candidate;
    } catch {
      // The secp256k1 range excludes a negligible subset of 32-byte values.
    }
  }
}

const authorizerKey = configuredValue("ARC_BORROW_AUTHORIZER_PRIVATE_KEY");
const agentKey =
  configuredValue("ARC_REPAYMENT_AGENT_PRIVATE_KEY") ??
  createPrivateKey(authorizerKey);

if (agentKey.toLowerCase() === authorizerKey?.toLowerCase()) {
  throw new Error(
    "ARC_REPAYMENT_AGENT_PRIVATE_KEY must differ from ARC_BORROW_AUTHORIZER_PRIVATE_KEY.",
  );
}

const agent = privateKeyToAccount(agentKey as `0x${string}`);

setValue("ARC_REPAYMENT_AGENT_PRIVATE_KEY", agentKey);
setValue(
  "REPAYMENT_AGENT_CRON_SECRET",
  configuredValue("REPAYMENT_AGENT_CRON_SECRET") ??
    randomBytes(48).toString("base64url"),
);

await writeFile(environmentPath, contents, { encoding: "utf8", mode: 0o600 });

console.log(
  "Repayment agent secrets are configured in the ignored .env file.",
);
console.log(`Repayment agent address: ${agent.address}`);
console.log("No private key or secret value was printed.");
