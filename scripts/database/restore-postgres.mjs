import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { databaseNameFromUrl, runPostgresTool } from "./postgres-tools.mjs";

const restoreUrl = process.env.RESTORE_DATABASE_URL;
const configuredBackupFile = process.env.BACKUP_FILE;
const confirmedDatabase = process.env.RESTORE_CONFIRM_DATABASE;

if (!restoreUrl) throw new Error("RESTORE_DATABASE_URL is required.");
if (!configuredBackupFile) throw new Error("BACKUP_FILE is required.");

const databaseName = databaseNameFromUrl(restoreUrl);
if (!confirmedDatabase || confirmedDatabase !== databaseName) {
  throw new Error(
    "RESTORE_CONFIRM_DATABASE must exactly match the target database name.",
  );
}

const backupFile = path.resolve(configuredBackupFile);
await access(backupFile);
try {
  const expected = (await readFile(`${backupFile}.sha256`, "utf8"))
    .trim()
    .split(/\s+/)[0];
  const actual = createHash("sha256")
    .update(await readFile(backupFile))
    .digest("hex");
  if (actual !== expected) throw new Error("Backup checksum does not match.");
} catch (error) {
  if (error?.code === "ENOENT") {
    throw new Error("Backup checksum file is missing.");
  }
  throw error;
}

await runPostgresTool(
  "psql",
  [
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--command",
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
  ],
  restoreUrl,
  { displayName: "clear confirmed restore target" },
);
await runPostgresTool(
  "pg_restore",
  [
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-acl",
    "--dbname",
    databaseName,
    backupFile,
  ],
  restoreUrl,
  { displayName: "pg_restore (credentials hidden)" },
);

process.stdout.write(
  `Restore completed for confirmed database ${databaseName}.\n`,
);
