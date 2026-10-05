import { afterEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";

import {
  HttpEmailSender,
  SmtpEmailSender,
} from "@/modules/notifications/infrastructure/http-email-sender";

const message = {
  to: "employee@example.test",
  subject: "Invitation",
  text: "Plain text",
  html: "<p>HTML</p>",
  idempotencyKey: "employee-invitation:test:1",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("HTTP email delivery", () => {
  it("fails clearly when email delivery is not configured", async () => {
    vi.stubEnv("EMAIL_DELIVERY_ENDPOINT", "");
    vi.stubEnv("EMAIL_DELIVERY_TOKEN", "");
    vi.stubEnv("EMAIL_FROM", "");

    await expect(new HttpEmailSender().send(message)).rejects.toThrow(
      "EMAIL_NOT_CONFIGURED",
    );
  });

  it("rejects incomplete configuration", async () => {
    vi.stubEnv("EMAIL_DELIVERY_ENDPOINT", "https://mail.example.test/send");
    vi.stubEnv("EMAIL_DELIVERY_TOKEN", "");
    vi.stubEnv("EMAIL_FROM", "Sender <sender@example.test>");

    await expect(new HttpEmailSender().send(message)).rejects.toThrow(
      "EMAIL_CONFIGURATION_INCOMPLETE",
    );
  });

  it("sends only provider fields and an idempotency header", async () => {
    vi.stubEnv("EMAIL_DELIVERY_ENDPOINT", "https://mail.example.test/send");
    vi.stubEnv("EMAIL_DELIVERY_TOKEN", "secret-token");
    vi.stubEnv("EMAIL_FROM", "Sender <sender@example.test>");
    let capturedRequest: RequestInit | undefined;
    const fetchMock = vi.fn(async (_url: URL, request?: RequestInit) => {
      capturedRequest = request;
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await new HttpEmailSender().send(message);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(capturedRequest?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "Idempotency-Key": message.idempotencyKey,
    });
    expect(JSON.parse(String(capturedRequest?.body))).toEqual({
      from: "Sender <sender@example.test>",
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it("does not treat provider rejection as successful delivery", async () => {
    vi.stubEnv("EMAIL_DELIVERY_ENDPOINT", "https://mail.example.test/send");
    vi.stubEnv("EMAIL_DELIVERY_TOKEN", "secret-token");
    vi.stubEnv("EMAIL_FROM", "Sender <sender@example.test>");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    await expect(new HttpEmailSender().send(message)).rejects.toThrow(
      "EMAIL_AUTHENTICATION_FAILED",
    );
  });
});

describe("SMTP email delivery", () => {
  it("sends through authenticated SMTP without exposing credentials", async () => {
    vi.stubEnv("EMAIL_SMTP_HOST", "smtp.gmail.com");
    vi.stubEnv("EMAIL_SMTP_PORT", "465");
    vi.stubEnv("EMAIL_SMTP_SECURE", "true");
    vi.stubEnv("EMAIL_SMTP_USER", "personal@gmail.com");
    vi.stubEnv("EMAIL_SMTP_PASSWORD", "app-password");
    vi.stubEnv("EMAIL_FROM", "Employee Lending <personal@gmail.com>");
    const sendMail = vi.fn(async () => ({ messageId: "message-1" }));
    const createTransport = vi.fn(() => ({ sendMail }));

    await new SmtpEmailSender(
      createTransport as unknown as typeof nodemailer.createTransport,
    ).send(message);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: "personal@gmail.com", pass: "app-password" },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith({
      from: "Employee Lending <personal@gmail.com>",
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it("maps Gmail authentication failures to a safe code", async () => {
    vi.stubEnv("EMAIL_SMTP_HOST", "smtp.gmail.com");
    vi.stubEnv("EMAIL_SMTP_USER", "personal@gmail.com");
    vi.stubEnv("EMAIL_SMTP_PASSWORD", "invalid-app-password");
    vi.stubEnv("EMAIL_FROM", "personal@gmail.com");
    const createTransport = vi.fn(() => ({
      sendMail: vi.fn(async () => {
        throw Object.assign(new Error("private provider response"), {
          code: "EAUTH",
          responseCode: 535,
        });
      }),
    }));

    await expect(
      new SmtpEmailSender(
        createTransport as unknown as typeof nodemailer.createTransport,
      ).send(message),
    ).rejects.toThrow("EMAIL_AUTHENTICATION_FAILED");
  });
});
