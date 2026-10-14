import {
  APPLICATION_NAME,
  APPLICATION_TAGLINE,
} from "@/shared/constants/application";
import {
  escapeHtml,
  formatEmailDate,
  transactionalEmailHtml,
} from "@/modules/notifications/domain/transactional-email";

export function invitationEmail(input: {
  appUrl: string;
  token: string;
  organizationName: string;
  email: string;
  expiresAt: Date;
  generatedAt?: Date;
}) {
  const link = new URL(
    `/invite/${encodeURIComponent(input.token)}`,
    input.appUrl,
  ).toString();
  const expiration = formatEmailDate(input.expiresAt);
  return {
    to: input.email,
    subject: `Join ${input.organizationName} on ${APPLICATION_NAME}`,
    text: `You've been invited to ${input.organizationName} on ${APPLICATION_NAME}.\n\n${APPLICATION_TAGLINE}\n\nAccept invitation: ${link}\n\nThis invitation was issued to ${input.email}.\nIt expires ${expiration}.`,
    html: transactionalEmailHtml({
      preheader: `${input.organizationName} invited you to join ${APPLICATION_NAME}.`,
      eyebrow: "You're invited",
      title: `Join ${input.organizationName} on ${APPLICATION_NAME}`,
      bodyHtml: `<p style="margin:0 0 14px;"><strong style="color:#14213D;">${escapeHtml(input.organizationName)}</strong> has invited you to join ${APPLICATION_NAME}.</p><p style="margin:0;color:#64748B;">Your organization has enabled secure employee borrowing and peer-to-peer funding. ${APPLICATION_TAGLINE}</p>`,
      action: { label: "Accept invitation", url: link },
      notice: {
        title: "Invitation details",
        bodyHtml: `<p style="margin:0;">This invitation was issued to ${escapeHtml(input.email)} and expires ${escapeHtml(expiration)}.</p>`,
      },
      generatedAt: input.generatedAt,
    }),
  };
}
