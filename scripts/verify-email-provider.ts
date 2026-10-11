import "dotenv/config";

import nodemailer from "nodemailer";

function failureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "EMAIL_PROVIDER_REJECTED";
  const code = "code" in error ? String(error.code) : "";
  const responseCode =
    "responseCode" in error ? Number(error.responseCode) : undefined;
  if (code === "EAUTH" || responseCode === 535) {
    return "EMAIL_AUTHENTICATION_FAILED";
  }
  if (["ECONNECTION", "ETIMEDOUT", "EDNS", "ESOCKET"].includes(code)) {
    return "EMAIL_PROVIDER_UNAVAILABLE";
  }
  if (responseCode === 429) return "EMAIL_RATE_LIMITED";
  if (responseCode && responseCode >= 500) {
    return "EMAIL_PROVIDER_UNAVAILABLE";
  }
  return "EMAIL_PROVIDER_REJECTED";
}

if (process.env.EMAIL_PROVIDER !== "smtp") {
  console.log(
    JSON.stringify({
      ok: false,
      readOnly: true,
      provider: process.env.EMAIL_PROVIDER ?? "http",
      code: "AUTH_ONLY_VERIFICATION_UNSUPPORTED",
    }),
  );
  process.exitCode = 2;
} else {
  const host = process.env.EMAIL_SMTP_HOST;
  const port = Number(process.env.EMAIL_SMTP_PORT ?? "465");
  const secure = (process.env.EMAIL_SMTP_SECURE ?? "true") === "true";
  const user = process.env.EMAIL_SMTP_USER;
  const password = process.env.EMAIL_SMTP_PASSWORD;
  if (!host || !user || !password || !Number.isInteger(port)) {
    console.log(
      JSON.stringify({
        ok: false,
        readOnly: true,
        provider: "smtp",
        code: "EMAIL_CONFIGURATION_INCOMPLETE",
      }),
    );
    process.exitCode = 1;
  } else {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    try {
      await transport.verify();
      console.log(
        JSON.stringify({
          ok: true,
          readOnly: true,
          provider: "smtp",
          code: "EMAIL_PROVIDER_CONNECTION_VERIFIED",
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          ok: false,
          readOnly: true,
          provider: "smtp",
          code: failureCode(error),
        }),
      );
      process.exitCode = 1;
    } finally {
      transport.close();
    }
  }
}
