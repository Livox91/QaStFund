import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { runCommand, runPostgresTool } from "./postgres-tools.mjs";

const databaseUrl = process.env.DATABASE_URL;
const configuredBackupFile = process.env.BACKUP_FILE;

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!configuredBackupFile) throw new Error("BACKUP_FILE is required.");

const backupFile = path.resolve(configuredBackupFile);
await mkdir(path.dirname(backupFile), { recursive: true });
const dockerService = process.env.POSTGRES_TOOLS_DOCKER_SERVICE;
const toolBackupFile = dockerService
  ? `/tmp/employee-p2p-backup-${process.pid}.dump`
  : backupFile;

try {
  await runPostgresTool(
    "pg_dump",
    [
      "--format=custom",
      "--compress=9",
      "--serializable-deferrable",
      "--no-owner",
      "--no-acl",
      "--file",
      toolBackupFile,
    ],
    databaseUrl,
    { displayName: "pg_dump (credentials hidden)" },
  );

  await runPostgresTool("pg_restore", ["--list", toolBackupFile], databaseUrl, {
    displayName: "pg_restore --list",
  });
  if (dockerService) {
    await runCommand(
      "docker",
      ["compose", "cp", `${dockerService}:${toolBackupFile}`, backupFile],
      { displayName: "copy verified backup from Docker Compose" },
    );
  }
} finally {
  if (dockerService) {
    await runCommand(
      "docker",
      [
        "compose",
        "exec",
        "--no-TTY",
        dockerService,
        "rm",
        "-f",
        toolBackupFile,
      ],
      { displayName: "remove temporary container backup" },
    ).catch(() => undefined);
  }
}

const details = await stat(backupFile);
if (details.size === 0) throw new Error("pg_dump created an empty backup.");

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
