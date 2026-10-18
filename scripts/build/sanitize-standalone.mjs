import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const standaloneDirectory = resolve(".next/standalone");

let entries;
try {
  entries = await readdir(standaloneDirectory, { withFileTypes: true });
} catch (error) {
  if (error?.code === "ENOENT") process.exit(0);
  throw error;
}

const environmentFiles = entries.filter(
  (entry) => entry.isFile() && /^\.env(?:\..+)?$/.test(entry.name),
);

for (const entry of environmentFiles) {
  await rm(resolve(standaloneDirectory, entry.name));
}

if (environmentFiles.length > 0) {
  console.info(
    `Removed ${environmentFiles.length} environment file(s) from the standalone build artifact.`,
  );
}
