import { describe, expect, it } from "vitest";

import { invitationEmail } from "@/modules/employee-invitations/domain/invitation-email";
import { passwordResetEmail } from "@/modules/employee-invitations/domain/password-reset-email";

const generatedAt = new Date("2026-10-14T12:00:00.000Z");

describe("QastFund transactional emails", () => {
  it("renders the password-reset action and security details with the real URL", () => {
    const email = passwordResetEmail({
      appUrl: "https://qastfund.example.test",
      token: "reset/token?secure=yes",
      organizationName: "Acme & Partners <Finance>",
      email: "employee@example.test",
      expiresAt: new Date("2026-10-14T13:00:00.000Z"),
      generatedAt,
    });
    const resetUrl =
      "https://qastfund.example.test/reset-password/reset%2Ftoken%3Fsecure%3Dyes";

    expect(email.text).toContain(resetUrl);
    expect(email.html).toContain(`href="${resetUrl}"`);
    expect(email.html).toContain(">Reset password</a>");
    expect(email.html).toContain("This link will expire in 1 hour");
    expect(email.html).toContain("Oct 14, 2026, 1:00 PM UTC");
    expect(email.html).toContain(
      "If you did not request a password reset, you can safely ignore this email.",
    );
    expect(email.html).toContain("Acme &amp; Partners &lt;Finance&gt;");
    expect(email.html).not.toContain("Acme & Partners <Finance>");
  });

  it("uses the shared responsive QastFund presentation and dynamic year", () => {
    const email = passwordResetEmail({
      appUrl: "https://qastfund.example.test",
      token: "reset-token",
      organizationName: "Acme",
      email: "employee@example.test",
      expiresAt: new Date("2026-10-14T13:00:00.000Z"),
      generatedAt,
    });

    expect(email.html).toContain('<table role="presentation"');
    expect(email.html).toContain("max-width:600px");
    expect(email.html).toContain("@media only screen and (max-width:620px)");
    expect(email.html).toContain("background:#F3F6FA");
    expect(email.html).toContain("background:#2563EB");
    expect(email.html).toContain("color:#14213D");
    expect(email.html).toContain("Secure access to your financial future.");
    expect(email.html).toContain("&copy; 2026 QastFund");
  });

  it("applies the same system to invitation emails without changing their URL", () => {
    const email = invitationEmail({
      appUrl: "https://qastfund.example.test",
      token: "invite-token",
      organizationName: "Acme",
      email: "employee+invite@example.test",
      expiresAt: new Date("2026-10-21T12:00:00.000Z"),
      generatedAt,
    });
    const invitationUrl = "https://qastfund.example.test/invite/invite-token";

    expect(email.subject).toBe("Join Acme on QastFund");
    expect(email.text).toContain(invitationUrl);
    expect(email.html).toContain(`href="${invitationUrl}"`);
    expect(email.html).toContain(">Accept invitation</a>");
    expect(email.html).toContain("employee+invite@example.test");
    expect(email.html).toContain("Oct 21, 2026, 12:00 PM UTC");
    expect(email.html).toContain("Secure access to your financial future.");
  });
});
