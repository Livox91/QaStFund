import { APPLICATION_NAME } from "@/shared/constants/application";

const EMAIL_FOOTER_TAGLINE = "Secure access to your financial future.";

type EmailAction = Readonly<{
  label: string;
  url: string;
}>;

type EmailNotice = Readonly<{
  title: string;
  bodyHtml: string;
}>;

export function transactionalEmailHtml(input: {
  preheader: string;
  eyebrow: string;
  title: string;
  bodyHtml: string;
  action?: EmailAction;
  notice?: EmailNotice;
  fallbackLabel?: string;
  generatedAt?: Date;
}) {
  const year = (input.generatedAt ?? new Date()).getUTCFullYear();
  const fallback = input.action
    ? `<tr>
        <td style="padding:0 40px 40px;">
          <p style="margin:0 0 8px;color:#64748B;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">${escapeHtml(input.fallbackLabel ?? "If the button does not work, copy and paste this link into your browser:")}</p>
          <p style="margin:0;overflow-wrap:anywhere;word-break:break-all;"><a href="${escapeHtml(input.action.url)}" style="color:#2563EB;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;text-decoration:underline;">${escapeHtml(input.action.url)}</a></p>
        </td>
      </tr>`
    : "";
  const action = input.action
    ? `<tr>
        <td align="left" style="padding:8px 40px 32px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" bgcolor="#2563EB" style="border-radius:8px;background:#2563EB;">
                <a href="${escapeHtml(input.action.url)}" style="display:inline-block;padding:14px 26px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:20px;text-decoration:none;">${escapeHtml(input.action.label)}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";
  const notice = input.notice
    ? `<tr>
        <td style="padding:0 40px 28px;">
          <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #E5EAF1;border-radius:8px;background:#F8FAFC;">
            <tr>
              <td style="padding:16px 18px;">
                <p style="margin:0 0 4px;color:#172033;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:20px;">${escapeHtml(input.notice.title)}</p>
                <div style="color:#64748B;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">${input.notice.bodyHtml}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(input.title)} | ${APPLICATION_NAME}</title>
    <style>
      @media only screen and (max-width:620px) {
        .email-shell { width:100% !important; }
        .email-pad { padding-left:24px !important; padding-right:24px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#F3F6FA;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}&#847; &zwnj; &nbsp; &#847; &zwnj; &nbsp;</div>
    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;background:#F3F6FA;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" class="email-shell" style="width:100%;max-width:600px;">
            <tr>
              <td class="email-pad" style="padding:0 24px 22px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="40" height="40" align="center" valign="middle" bgcolor="#2563EB" style="width:40px;height:40px;border-radius:10px;background:#2563EB;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;line-height:40px;">Q</td>
                    <td style="padding-left:12px;color:#14213D;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.3px;">${APPLICATION_NAME}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="border:1px solid #E5EAF1;border-radius:12px;background:#FFFFFF;overflow:hidden;">
                <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="email-pad" style="padding:40px 40px 12px;">
                      <p style="margin:0 0 10px;color:#2563EB;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;line-height:18px;letter-spacing:1.2px;text-transform:uppercase;">${escapeHtml(input.eyebrow)}</p>
                      <h1 style="margin:0;color:#14213D;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:700;line-height:38px;letter-spacing:-0.5px;">${escapeHtml(input.title)}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td class="email-pad" style="padding:8px 40px 24px;color:#172033;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:26px;">${input.bodyHtml}</td>
                  </tr>
                  ${action}
                  ${notice}
                  ${fallback}
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" class="email-pad" style="padding:24px 24px 0;color:#64748B;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;">
                <p style="margin:0 0 4px;">${EMAIL_FOOTER_TAGLINE}</p>
                <p style="margin:0;">&copy; ${year} ${APPLICATION_NAME}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatEmailDate(value: Date) {
  return value.toLocaleString("en-US", {
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
