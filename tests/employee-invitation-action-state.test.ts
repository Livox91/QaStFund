import { describe, expect, it } from "vitest";

import { formatInvitationRateLimitMessage } from "@/app/(employer)/employer/employees/invitation-action-state";

describe("employee invitation action state", () => {
  it("shows the exact retry delay", () => {
    expect(formatInvitationRateLimitMessage(42)).toBe(
      "Too many invitation requests. Try again in 42 seconds.",
    );
  });

  it("normalizes short and fractional retry delays", () => {
    expect(formatInvitationRateLimitMessage(0)).toBe(
      "Too many invitation requests. Try again in 1 second.",
    );
    expect(formatInvitationRateLimitMessage(1.2)).toBe(
      "Too many invitation requests. Try again in 2 seconds.",
    );
  });
});
