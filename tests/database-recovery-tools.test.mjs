import { describe, expect, it } from "vitest";

import {
  databaseNameFromUrl,
  databaseUrlWithName,
  redactCommandOutput,
} from "../scripts/database/postgres-tools.mjs";

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
});
