import { describe, expect, it } from "vitest";

import { evaluateAuditReport } from "../scripts/testing/verify-dependency-audit.mjs";

const lockfile = {
  packages: {
    "node_modules/deepmerge-ts": { version: "7.1.5" },
    "node_modules/braces": { version: "3.0.3" },
  },
};

function reportWith(advisory) {
  return {
    vulnerabilities: {
      affected: {
        severity: "high",
        via: [advisory],
      },
    },
  };
}

describe("dependency audit policy", () => {
  it("accepts only the specifically reviewed unfixed advisories", () => {
    const result = evaluateAuditReport(
      reportWith({ source: 1145093, name: "deepmerge-ts", severity: "high" }),
      lockfile,
    );
    expect(result.problems).toEqual([]);
  });

  it("fails an introduced actionable high-severity advisory", () => {
    const result = evaluateAuditReport(
      reportWith({
        source: 9999999,
        name: "introduced-package",
        severity: "high",
        url: "https://example.invalid/advisory",
      }),
      lockfile,
    );
    expect(result.problems).toContain(
      "Unapproved high advisory https://example.invalid/advisory affects introduced-package.",
    );
  });

  it("requires re-review when an allowlisted package version changes", () => {
    const changedLockfile = {
      packages: {
        ...lockfile.packages,
        "node_modules/deepmerge-ts": { version: "7.2.0" },
      },
    };
    const result = evaluateAuditReport(
      reportWith({ source: 1145093, name: "deepmerge-ts", severity: "high" }),
      changedLockfile,
    );
    expect(result.problems[0]).toContain("changed from reviewed version");
  });
});
