import "server-only";

import nodemailer from "nodemailer";

import type {
  EmailMessage,
  EmailSender,
} from "@/modules/notifications/domain/email";

export class HttpEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    const endpoint = process.env.EMAIL_DELIVERY_ENDPOINT;
    const token = process.env.EMAIL_DELIVERY_TOKEN;
    const from = process.env.EMAIL_FROM;
    if (!endpoint && !token && !from) throw new Error("EMAIL_NOT_CONFIGURED");
    if (!endpoint || !token || !from)
      throw new Error("EMAIL_CONFIGURATION_INCOMPLETE");
    let endpointUrl: URL;
    try {
      endpointUrl = new URL(endpoint);
    } catch {
      throw new Error("EMAIL_ENDPOINT_INVALID");
    }
    if (
      process.env.NODE_ENV === "production" &&
      endpointUrl.protocol !== "https:"
    )
      throw new Error("EMAIL_ENDPOINT_MUST_USE_HTTPS");
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(message.idempotencyKey
          ? { "Idempotency-Key": message.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error("EMAIL_AUTHENTICATION_FAILED");
      if (response.status === 429) throw new Error("EMAIL_RATE_LIMITED");
      if (response.status >= 500) throw new Error("EMAIL_PROVIDER_UNAVAILABLE");
      throw new Error("EMAIL_PROVIDER_REJECTED");
    }
  }
}

type MailTransport = Pick<
  ReturnType<typeof nodemailer.createTransport>,
  "sendMail"
>;

function smtpFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "EMAIL_DELIVERY_FAILED";
  const code = "code" in error ? String(error.code) : "";
  const responseCode =
    "responseCode" in error ? Number(error.responseCode) : undefined;
  if (code === "EAUTH" || responseCode === 535)
    return "EMAIL_AUTHENTICATION_FAILED";
  if (["ECONNECTION", "ETIMEDOUT", "EDNS", "ESOCKET"].includes(code))
    return "EMAIL_PROVIDER_UNAVAILABLE";
  if (responseCode === 429) return "EMAIL_RATE_LIMITED";
  if (responseCode && responseCode >= 500) return "EMAIL_PROVIDER_UNAVAILABLE";
  return "EMAIL_PROVIDER_REJECTED";
}

export class SmtpEmailSender implements EmailSender {
  constructor(
    private readonly createTransport: typeof nodemailer.createTransport = nodemailer.createTransport,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const host = process.env.EMAIL_SMTP_HOST;
    const port = Number(process.env.EMAIL_SMTP_PORT ?? "465");
    const secure = (process.env.EMAIL_SMTP_SECURE ?? "true") === "true";
    const user = process.env.EMAIL_SMTP_USER;
    const password = process.env.EMAIL_SMTP_PASSWORD;
    const from = process.env.EMAIL_FROM;
    if (!host && !user && !password && !from)
      throw new Error("EMAIL_NOT_CONFIGURED");
    if (!host || !user || !password || !from || !Number.isInteger(port))
      throw new Error("EMAIL_CONFIGURATION_INCOMPLETE");
    const transport: MailTransport = this.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    try {
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      throw new Error(smtpFailureCode(error));
    }
  }
}

class ConfiguredEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    if (process.env.EMAIL_PROVIDER === "smtp") {
      return new SmtpEmailSender().send(message);
    }
    return new HttpEmailSender().send(message);
  }
}

export const emailSender = new ConfiguredEmailSender();
