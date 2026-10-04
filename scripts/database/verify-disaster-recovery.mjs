import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  databaseNameFromUrl,
  databaseUrlWithName,
  quoteIdentifier,
  runCommand,
  runPostgresTool,
} from "./postgres-tools.mjs";

const repositoryRoot = process.cwd();
const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!adminUrl)
  throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required.");

const baseName = databaseNameFromUrl(adminUrl).replace(/[^a-zA-Z0-9_]/g, "_");
const sourceName = `dr_${baseName.slice(0, 42)}_source`;
const restoreName = `dr_${baseName.slice(0, 41)}_restore`;
const sourceUrl = databaseUrlWithName(adminUrl, sourceName);
const restoreUrl = databaseUrlWithName(adminUrl, restoreName);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeCommand = process.execPath;

await runCommand("psql", ["--version"], {
  displayName: "verify psql availability",
  echoOutput: true,
});
await runCommand("pg_dump", ["--version"], {
  displayName: "verify pg_dump availability",
  echoOutput: true,
});
await runCommand("pg_restore", ["--version"], {
  displayName: "verify pg_restore availability",
  echoOutput: true,
});

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "p2p-dr-"));
const backupFile = path.join(temporaryDirectory, "database.dump");

async function recreateDatabase(databaseName) {
  const identifier = quoteIdentifier(databaseName);
  await runPostgresTool(
    "psql",
    [
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid(); DROP DATABASE IF EXISTS ${identifier};`,
      "--command",
      `CREATE DATABASE ${identifier} TEMPLATE template0;`,
    ],
    adminUrl,
    { displayName: `recreate disposable database ${databaseName}` },
  );
}

async function dropDatabase(databaseName) {
  const identifier = quoteIdentifier(databaseName);
  await runPostgresTool(
    "psql",
    [
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid(); DROP DATABASE IF EXISTS ${identifier};`,
    ],
    adminUrl,
    { displayName: `drop disposable database ${databaseName}` },
  );
}

try {
  await recreateDatabase(sourceName);
  await runCommand(npmCommand, ["run", "prisma:deploy"], {
    cwd: repositoryRoot,
    env: { DATABASE_URL: sourceUrl },
    displayName: "apply all migrations to fresh source database",
    echoOutput: true,
  });
  await runCommand(npmCommand, ["run", "prisma:status"], {
    cwd: repositoryRoot,
    env: { DATABASE_URL: sourceUrl },
    displayName: "verify fresh source migration status",
    echoOutput: true,
  });

  await runPostgresTool(
    "psql",
    [
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      `INSERT INTO "BlockchainReconciliationCursor" ("id", "chainId", "contractAddress", "nextBlock", "finalizedThrough", "latestObservedBlock", "lastSuccessfulAt", "consecutiveFailures", "createdAt", "updatedAt") VALUES ('00000000-0000-4000-8000-000000000042', 5042002, '0x1111111111111111111111111111111111111111', 4243, 4237, 4242, CURRENT_TIMESTAMP, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
    ],
    sourceUrl,
    { displayName: "insert safe reconciliation restore fixture" },
  );

  await runCommand(nodeCommand, ["scripts/database/backup-postgres.mjs"], {
    cwd: repositoryRoot,
    env: { DATABASE_URL: sourceUrl, BACKUP_FILE: backupFile },
    displayName: "create and validate logical backup",
    echoOutput: true,
  });

  await recreateDatabase(restoreName);
  await runCommand(nodeCommand, ["scripts/database/restore-postgres.mjs"], {
    cwd: repositoryRoot,
    env: {
      BACKUP_FILE: backupFile,
      RESTORE_DATABASE_URL: restoreUrl,
      RESTORE_CONFIRM_DATABASE: restoreName,
    },
    displayName: "restore logical backup into disposable database",
    echoOutput: true,
  });
  await runCommand(npmCommand, ["run", "prisma:status"], {
    cwd: repositoryRoot,
    env: { DATABASE_URL: restoreUrl },
    displayName: "verify restored migration status",
    echoOutput: true,
  });

  const restoredCursor = await runPostgresTool(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      `SELECT "nextBlock" || ':' || "finalizedThrough" || ':' || "latestObservedBlock" FROM "BlockchainReconciliationCursor" WHERE "id" = '00000000-0000-4000-8000-000000000042';`,
    ],
    restoreUrl,
    { displayName: "verify restored reconciliation cursor" },
  );
  if (restoredCursor.stdout.trim() !== "4243:4237:4242") {
    throw new Error(
      "Restored reconciliation cursor does not match the backup.",
    );
  }

  await runCommand(
    npmCommand,
    [
      "test",
      "--",
      "--run",
      "tests/disaster-recovery-database.test.ts",
      "tests/blockchain-reconciliation-database.test.ts",
    ],
    {
      cwd: repositoryRoot,
      env: {
        DATABASE_URL: restoreUrl,
        DR_RESTORE_VERIFICATION: "true",
      },
      displayName: "run application reconciliation tests on restored database",
      echoOutput: true,
    },
  );

  process.stdout.write(
    "Disaster-recovery verification passed: migrations, backup, restore, cursor resume, and idempotent reconciliation.\n",
  );
} finally {
  if (process.env.KEEP_DR_DATABASES !== "true") {
    await dropDatabase(restoreName).catch(() => undefined);
    await dropDatabase(sourceName).catch(() => undefined);
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
