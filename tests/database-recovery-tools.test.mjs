import { describe, expect, it } from "vitest";

import {
  assertPathsDoNotExist,
  databaseNameFromUrl,
  databaseUrlWithName,
  redactCommandOutput,
} from "../scripts/database/postgres-tools.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("database recovery tooling", () => {
  it("redacts credentials from PostgreSQL command output", () => {
    const output = redactCommandOutput(
      "failed postgresql://operator:super-secret@db.internal/app password=another-secret",
    );

    expect(output).not.toContain("super-secret");
    expect(output).not.toContain("another-secret");
    expect(output).toContain("[REDACTED]");
  });

  it("derives safe disposable database URLs without logging them", () => {
    const source =
      "postgresql://operator:super-secret@db.internal:5432/application?sslmode=require";
    const disposable = databaseUrlWithName(source, "dr_application_restore");

    expect(databaseNameFromUrl(disposable)).toBe("dr_application_restore");
    expect(new URL(disposable).searchParams.get("sslmode")).toBe("require");
  });

  it("rejects unsafe disposable database names", () => {
    expect(() =>
      databaseUrlWithName("postgresql://db/app", "production-db"),
    ).toThrow("unsafe characters");
  });

  it("refuses to overwrite an existing backup or checksum", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "backup-path-test-"),
    );
    const backup = path.join(directory, "database.dump");
    try {
      await expect(assertPathsDoNotExist([backup])).resolves.toBeUndefined();
      await writeFile(backup, "existing backup");
      await expect(assertPathsDoNotExist([backup])).rejects.toThrow(
        "Refusing to overwrite existing file",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
