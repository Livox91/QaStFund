import { describe, expect, it } from "vitest";

import { enforceAuditRecordBound } from "../scripts/audit-record-bound";

describe("Arc audit record bound", () => {
  it("retains all records at the configured bound", () => {
    expect(enforceAuditRecordBound([1, 2, 3], 3)).toEqual({
      records: [1, 2, 3],
      overflowed: false,
    });
  });

  it("detects a sentinel record beyond the configured bound", () => {
    expect(enforceAuditRecordBound([1, 2, 3, 4], 3)).toEqual({
      records: [1, 2, 3],
      overflowed: true,
    });
  });

  it("rejects an invalid configured bound", () => {
    expect(() => enforceAuditRecordBound([], 0)).toThrow(
      "Audit record maximum must be a positive integer.",
    );
  });
});
