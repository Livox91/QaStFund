import "dotenv/config";

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

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
const runId = `${process.pid}_${Date.now().toString(36)}`;
const sourceName = `dr_${baseName.slice(0, 28)}_${runId}_source`;
const restoreName = `dr_${baseName.slice(0, 27)}_${runId}_restore`;
const sourceUrl = databaseUrlWithName(adminUrl, sourceName);
const restoreUrl = databaseUrlWithName(adminUrl, restoreName);
const npmCommand =
  process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
const npmPrefix = process.platform === "win32" ? ["/d", "/s", "/c", "npm"] : [];
const nodeCommand = process.execPath;

await runPostgresTool("psql", ["--version"], adminUrl, {
  displayName: "verify psql availability",
  echoOutput: true,
});
await runPostgresTool("pg_dump", ["--version"], adminUrl, {
  displayName: "verify pg_dump availability",
  echoOutput: true,
});
await runPostgresTool("pg_restore", ["--version"], adminUrl, {
  displayName: "verify pg_restore availability",
  echoOutput: true,
});

const startedAt = performance.now();
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "p2p-dr-"));
const retainedArtifactDirectory = process.env.DR_ARTIFACT_DIRECTORY
  ? path.resolve(process.env.DR_ARTIFACT_DIRECTORY)
  : undefined;
if (retainedArtifactDirectory) {
  await mkdir(retainedArtifactDirectory, { recursive: true });
}
const backupFile = path.join(
  retainedArtifactDirectory ?? temporaryDirectory,
  `database-${runId}.dump`,
);

async function expectCommandFailure(command, args, options, label) {
  try {
    await runCommand(command, args, options);
  } catch {
    process.stdout.write(`Expected failure verified: ${label}.\n`);
    return;
  }
  throw new Error(`Expected failure did not occur: ${label}.`);
}

async function verifyRestoreMarker() {
  const marker = await runPostgresTool(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      'SELECT value FROM "DrRestoreMarker" WHERE id = 1;',
    ],
    restoreUrl,
    { displayName: "verify failed restore did not clear target" },
  );
  if (marker.stdout.trim() !== "preserve-me") {
    throw new Error("A failed restore altered the disposable target.");
  }
}

async function writeChecksum(file) {
  const digest = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  await writeFile(`${file}.sha256`, `${digest}  ${path.basename(file)}\n`);
}

async function recreateDatabase(databaseName) {
  const identifier = quoteIdentifier(databaseName);
  await runPostgresTool(
    "psql",
    [
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();`,
      "--command",
      `DROP DATABASE IF EXISTS ${identifier};`,
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
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid();`,
      "--command",
      `DROP DATABASE IF EXISTS ${identifier};`,
    ],
    adminUrl,
    { displayName: `drop disposable database ${databaseName}` },
  );
}

try {
  await recreateDatabase(sourceName);
  await runCommand(npmCommand, [...npmPrefix, "run", "prisma:deploy"], {
    cwd: repositoryRoot,
    env: { DATABASE_URL: sourceUrl },
    displayName: "apply all migrations to fresh source database",
    echoOutput: true,
  });
  await runCommand(npmCommand, [...npmPrefix, "run", "prisma:status"], {
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
      `INSERT INTO "Organization" ("id", "name", "slug", "createdAt", "updatedAt") VALUES ('00000000-0000-4000-8000-000000000044', 'DR Fixture', 'dr-fixture', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
       INSERT INTO "User" ("id", "email", "name", "passwordHash", "createdAt", "updatedAt") VALUES ('00000000-0000-4000-8000-000000000045', 'dr-fixture@example.invalid', 'DR Fixture', 'not-a-real-password-hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
       INSERT INTO "OrganizationMembership" ("id", "organizationId", "userId", "role", "createdAt", "updatedAt") VALUES ('00000000-0000-4000-8000-000000000046', '00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000045', 'EMPLOYEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
       INSERT INTO "BlockchainReconciliationCursor" ("id", "chainId", "contractAddress", "nextBlock", "finalizedThrough", "latestObservedBlock", "lastSuccessfulAt", "consecutiveFailures", "createdAt", "updatedAt") VALUES ('00000000-0000-4000-8000-000000000042', 5042002, '0x1111111111111111111111111111111111111111', 4243, 4237, 4242, CURRENT_TIMESTAMP, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
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

  const backupDetails = await stat(backupFile);
  const checksum = (await readFile(`${backupFile}.sha256`, "utf8"))
    .trim()
    .split(/\s+/)[0];
  process.stdout.write(
    `Recovery artifact verified: ${path.basename(backupFile)} (${backupDetails.size} bytes, SHA-256 ${checksum}).\n`,
  );

  await recreateDatabase(restoreName);
  await runPostgresTool(
    "psql",
    [
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      'CREATE TABLE "DrRestoreMarker" (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO "DrRestoreMarker" VALUES (1, \'preserve-me\');',
    ],
    restoreUrl,
    { displayName: "create disposable failed-restore marker" },
  );

  const corruptBackup = path.join(temporaryDirectory, "corrupt.dump");
  await copyFile(backupFile, corruptBackup);
  await copyFile(`${backupFile}.sha256`, `${corruptBackup}.sha256`);
  await writeFile(corruptBackup, "corrupt", { flag: "a" });
  await expectCommandFailure(
    nodeCommand,
    ["scripts/database/restore-postgres.mjs"],
    {
      cwd: repositoryRoot,
      env: {
        BACKUP_FILE: corruptBackup,
        RESTORE_DATABASE_URL: restoreUrl,
        RESTORE_CONFIRM_DATABASE: restoreName,
      },
      displayName: "reject corrupt backup",
    },
    "corrupt backup checksum",
  );
  await verifyRestoreMarker();

  const incompleteBackup = path.join(temporaryDirectory, "incomplete.dump");
  await copyFile(backupFile, incompleteBackup);
  await expectCommandFailure(
    nodeCommand,
    ["scripts/database/restore-postgres.mjs"],
    {
      cwd: repositoryRoot,
      env: {
        BACKUP_FILE: incompleteBackup,
        RESTORE_DATABASE_URL: restoreUrl,
        RESTORE_CONFIRM_DATABASE: restoreName,
      },
      displayName: "reject incomplete backup",
    },
    "missing checksum sidecar",
  );
  await verifyRestoreMarker();

  const interruptedBackup = path.join(temporaryDirectory, "interrupted.dump");
  const completeBytes = await readFile(backupFile);
  await writeFile(
    interruptedBackup,
    completeBytes.subarray(
      0,
      Math.max(1, Math.floor(completeBytes.length / 2)),
    ),
  );
  await writeChecksum(interruptedBackup);
  await expectCommandFailure(
    nodeCommand,
    ["scripts/database/restore-postgres.mjs"],
    {
      cwd: repositoryRoot,
      env: {
        BACKUP_FILE: interruptedBackup,
        RESTORE_DATABASE_URL: restoreUrl,
        RESTORE_CONFIRM_DATABASE: restoreName,
      },
      displayName: "reject interrupted backup transfer",
    },
    "structurally incomplete archive before target clear",
  );
  await verifyRestoreMarker();

  await expectCommandFailure(
    nodeCommand,
    ["scripts/database/restore-postgres.mjs"],
    {
      cwd: repositoryRoot,
      env: {
        BACKUP_FILE: backupFile,
        RESTORE_DATABASE_URL: restoreUrl,
        RESTORE_CONFIRM_DATABASE: restoreName,
        POSTGRES_TOOLS_DOCKER_SERVICE: "unavailable-dr-postgres-service",
      },
      displayName: "reject unavailable PostgreSQL tooling dependency",
    },
    "unavailable PostgreSQL dependency",
  );
  await verifyRestoreMarker();

  await recreateDatabase(restoreName);
  const restoreStartedAt = performance.now();
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
  const restoreDurationMs = performance.now() - restoreStartedAt;
  await runCommand(npmCommand, [...npmPrefix, "run", "prisma:status"], {
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

  const restoredIdentityRows = await runPostgresTool(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      `SELECT (SELECT count(*) FROM "Organization" WHERE "id" = '00000000-0000-4000-8000-000000000044') || ':' || (SELECT count(*) FROM "User" WHERE "id" = '00000000-0000-4000-8000-000000000045') || ':' || (SELECT count(*) FROM "OrganizationMembership" WHERE "id" = '00000000-0000-4000-8000-000000000046');`,
    ],
    restoreUrl,
    { displayName: "verify restored essential identity records" },
  );
  if (restoredIdentityRows.stdout.trim() !== "1:1:1") {
    throw new Error(
      "Restored essential identity records do not match the backup.",
    );
  }

  await runCommand(
    nodeCommand,
    [
      path.join(repositoryRoot, "node_modules", "vitest", "vitest.mjs"),
      "run",
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
    `Disaster-recovery verification passed in ${((performance.now() - startedAt) / 1000).toFixed(1)}s (restore ${(
      restoreDurationMs / 1000
    ).toFixed(
      1,
    )}s): migrations, backup, failure safety, essential records, cursor resume, financial invariants, and idempotent reconciliation. RPO was not established because this isolated fixture has no production backup schedule evidence.\n`,
  );
} finally {
  if (process.env.KEEP_DR_DATABASES !== "true") {
    await dropDatabase(restoreName).catch(() => undefined);
    await dropDatabase(sourceName).catch(() => undefined);
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
