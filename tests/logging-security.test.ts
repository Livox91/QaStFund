import { describe, expect, it, vi } from "vitest";

import { logger, redactLogValue } from "@/infrastructure/logging/logger";

describe("security logging", () => {
  it("redacts bearer tokens, named secrets, and URL credentials", () => {
    const result = redactLogValue(
      "Bearer abc.def token=token-value password:password-value https://user:pass@example.test/path",
    );

    expect(result).not.toContain("abc.def");
    expect(result).not.toContain("token-value");
    expect(result).not.toContain("password-value");
    expect(result).not.toContain("user:pass");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts sensitive context keys and provider error messages", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    logger.error(
      "Provider request failed",
      new Error("Authorization: Bearer provider-access-token"),
      {
        organizationId: "organization-a",
        accessToken: "context-access-token",
      },
    );

    expect(consoleError).toHaveBeenCalledWith("Provider request failed", {
      organizationId: "organization-a",
      accessToken: "[REDACTED]",
      error: "Authorization: [REDACTED] [REDACTED]",
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "provider-access-token",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "context-access-token",
    );
    consoleError.mockRestore();
  });
});
