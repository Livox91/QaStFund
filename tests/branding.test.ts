import { describe, expect, it } from "vitest";

import { buildArcWalletChallengeMessage } from "@/modules/arc-wallet/application/arc-wallet-enrollment";
import { invitationEmail } from "@/modules/employee-invitations/domain/invitation-email";
import { passwordResetEmail } from "@/modules/employee-invitations/domain/password-reset-email";
import {
  APPLICATION_NAME,
  APPLICATION_TAGLINE,
} from "@/shared/constants/application";

describe("QastFund public branding", () => {
  it("keeps the canonical product name and tagline centralized", () => {
    expect(APPLICATION_NAME).toBe("QastFund");
    expect(APPLICATION_TAGLINE).toBe("Finance that moves with you.");
  });

  it("brands invitation and password-reset messages", () => {
    const invitation = invitationEmail({
      appUrl: "https://qastfund.example.test",
      token: "invite-token",
      organizationName: "Acme",
      email: "employee@example.test",
      expiresAt: new Date("2026-10-13T12:00:00.000Z"),
    });
    const reset = passwordResetEmail({
      appUrl: "https://qastfund.example.test",
      token: "reset-token",
      organizationName: "Acme",
      email: "employee@example.test",
      expiresAt: new Date("2026-10-13T13:00:00.000Z"),
    });

    expect(invitation.subject).toBe("Join Acme on QastFund");
    expect(invitation.text).toContain(APPLICATION_TAGLINE);
    expect(invitation.html).toContain("QastFund");
    expect(reset.subject).toBe("Reset your QastFund password");
    expect(reset.text).toContain("QastFund");
  });

  it("uses QastFund in new wallet ownership challenges", () => {
    expect(
      buildArcWalletChallengeMessage({
        organizationId: "10000000-0000-4000-8000-000000000001",
        userId: "20000000-0000-4000-8000-000000000001",
        address: "0x1111111111111111111111111111111111111111",
        nonce: "nonce",
        expiresAt: new Date("2026-10-12T12:00:00.000Z"),
      }),
    ).toMatch(/^QastFund Arc Wallet Verification\n/);
  });
});
