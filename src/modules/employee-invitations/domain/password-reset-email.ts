import { APPLICATION_NAME } from "@/shared/constants/application";
import {
  escapeHtml,
  formatEmailDate,
  transactionalEmailHtml,
} from "@/modules/notifications/domain/transactional-email";

export function passwordResetEmail(input: {
  appUrl: string;
  token: string;
  organizationName: string;
  email: string;
  expiresAt: Date;
  generatedAt?: Date;
}) {
  const link = new URL(
    `/reset-password/${encodeURIComponent(input.token)}`,
    input.appUrl,
  ).toString();
  const expiration = formatEmailDate(input.expiresAt);
  return {
    to: input.email,
    subject: `Reset your ${APPLICATION_NAME} password`,
    text: `Reset your ${APPLICATION_NAME} password: ${link}\nThis link expires in one hour.`,
    html: transactionalEmailHtml({
      preheader: `Reset your ${APPLICATION_NAME} password securely.`,
      eyebrow: "Account security",
      title: "Reset your password",
      bodyHtml: `<p style="margin:0 0 14px;">We received a request to reset the password for your ${APPLICATION_NAME} account with <strong style="color:#14213D;">${escapeHtml(input.organizationName)}</strong>.</p><p style="margin:0;color:#64748B;">Click the button below to choose a new password.</p>`,
      action: { label: "Reset password", url: link },
      notice: {
        title: "Security notice",
        bodyHtml: `<p style="margin:0;">This link will expire in 1 hour, at ${escapeHtml(expiration)}. If you did not request a password reset, you can safely ignore this email.</p>`,
      },
      generatedAt: input.generatedAt,
    }),
  };
}
