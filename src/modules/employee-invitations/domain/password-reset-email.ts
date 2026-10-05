export function passwordResetEmail(input: {
  appUrl: string;
  token: string;
  organizationName: string;
  email: string;
}) {
  const link = new URL(
    `/reset-password/${encodeURIComponent(input.token)}`,
    input.appUrl,
  ).toString();
  return {
    to: input.email,
    subject: "Reset your P2P Lending password",
    text: `Reset your password: ${link}\nThis link expires in one hour.`,
    html: `<p>Reset your password for ${escapeHtml(input.organizationName)}.</p><p><a href="${link}">Reset password</a></p><p>This link expires in one hour.</p>`,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
