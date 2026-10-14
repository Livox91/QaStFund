import "dotenv/config";

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import pg from "pg";

const { Client } = pg;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TEST_DATABASE_PREFIX = "qastfund_test_";

function quoteIdentifier(identifier) {
  if (!new RegExp(`^${TEST_DATABASE_PREFIX}[a-z0-9_]+$`).test(identifier)) {
    throw new Error(`Refusing unsafe test database identifier ${identifier}.`);
  }
  return `"${identifier}"`;
}

function runNode(entrypoint, args, environment) {
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to create an isolated test database.",
    );
  }

  const sourceUrl = new URL(process.env.DATABASE_URL);
  if (!LOCAL_HOSTS.has(sourceUrl.hostname)) {
    throw new Error(
      `Tests refuse non-local database host ${sourceUrl.hostname}. Use a local PostgreSQL instance.`,
    );
  }

  const databaseName = `${TEST_DATABASE_PREFIX}${Date.now()}_${process.pid}`;
  const quotedDatabaseName = quoteIdentifier(databaseName);
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  const admin = new Client({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 5_000,
  });
  const testEnvironment = {
    ...process.env,
    DATABASE_URL: testUrl.toString(),
    NODE_ENV: "test",
  };

  await admin.connect();
  await admin.query(`CREATE DATABASE ${quotedDatabaseName}`);
  console.log(`Created isolated test database ${databaseName}.`);

  let exitCode = 1;
  try {
    const prismaCli = resolve("node_modules/prisma/build/index.js");
    const vitestCli = resolve("node_modules/vitest/vitest.mjs");
    const migrationResult = runNode(
      prismaCli,
      ["migrate", "deploy"],
      testEnvironment,
    );
    if (migrationResult !== 0) {
      throw new Error(
        `Test database migration failed with code ${migrationResult}.`,
      );
    }

    exitCode = runNode(
      vitestCli,
      ["run", ...process.argv.slice(2)],
      testEnvironment,
    );
  } finally {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await admin.query(`DROP DATABASE ${quotedDatabaseName}`);
    await admin.end();
    console.log(`Dropped isolated test database ${databaseName}.`);
  }

  process.exitCode = exitCode;
}

await main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Isolated tests failed.",
  );
  process.exitCode = 1;
});
