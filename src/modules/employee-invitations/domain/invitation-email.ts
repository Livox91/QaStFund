export function invitationEmail(input: {
  appUrl: string;
  token: string;
  organizationName: string;
  email: string;
  expiresAt: Date;
}) {
  const link = new URL(
    `/invite/${encodeURIComponent(input.token)}`,
    input.appUrl,
  ).toString();
  const expiration = input.expiresAt.toLocaleString("en-US", {
    timeZone: "UTC",
    timeZoneName: "short",
  });
  return {
    to: input.email,
    subject: `Join ${input.organizationName}'s P2P Lending platform`,
    text: `You've been invited to ${input.organizationName}'s P2P Lending platform.\n\nAccept invitation: ${link}\n\nThis invitation was issued to ${input.email}.\nIt expires ${expiration}.`,
    html: `<p>You've been invited to <strong>${escapeHtml(input.organizationName)}</strong>'s P2P Lending platform.</p><p>Your organization has enabled secure employee borrowing and lending.</p><p><a href="${link}">Accept invitation</a></p><p>This invitation was issued to ${escapeHtml(input.email)}.</p><p>Invitation expires: ${expiration}</p>`,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
