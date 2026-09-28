import { describe, expect, it } from "vitest";

import { isNonEmptyString } from "@/shared/utils/strings";

describe("test environment", () => {
  it("loads TypeScript modules through the project alias", () => {
    expect(isNonEmptyString("ready")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(false);
  });
});
