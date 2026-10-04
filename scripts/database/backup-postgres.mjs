import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { runPostgresTool } from "./postgres-tools.mjs";

const databaseUrl = process.env.DATABASE_URL;
const configuredBackupFile = process.env.BACKUP_FILE;

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!configuredBackupFile) throw new Error("BACKUP_FILE is required.");

const backupFile = path.resolve(configuredBackupFile);
await mkdir(path.dirname(backupFile), { recursive: true });

await runPostgresTool(
  "pg_dump",
  [
    "--format=custom",
    "--compress=9",
    "--serializable-deferrable",
    "--no-owner",
    "--no-acl",
    "--file",
    backupFile,
  ],
  databaseUrl,
  { displayName: "pg_dump (credentials hidden)" },
);

const details = await stat(backupFile);
if (details.size === 0) throw new Error("pg_dump created an empty backup.");
await runPostgresTool("pg_restore", ["--list", backupFile], databaseUrl, {
  displayName: "pg_restore --list",
});

const digest = createHash("sha256")
  .update(await readFile(backupFile))
  .digest("hex");
await writeFile(
  `${backupFile}.sha256`,
  `${digest}  ${path.basename(backupFile)}\n`,
  "utf8",
);

process.stdout.write(
  `Backup verified: ${path.basename(backupFile)} (${details.size} bytes)\n`,
);
