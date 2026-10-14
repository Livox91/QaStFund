import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { invitationEmail } from "@/modules/employee-invitations/domain/invitation-email";
import { passwordResetEmail } from "@/modules/employee-invitations/domain/password-reset-email";

const generatedAt = new Date();
const outputDirectory = join(process.cwd(), "artifacts", "email-previews");

const previews = {
  "password-reset.html": passwordResetEmail({
    appUrl: "https://app.qastfund.example",
    token: "preview-reset-token",
    organizationName: "Northstar Finance",
    email: "employee@example.com",
    expiresAt: new Date(generatedAt.getTime() + 60 * 60_000),
    generatedAt,
  }).html,
  "employee-invitation.html": invitationEmail({
    appUrl: "https://app.qastfund.example",
    token: "preview-invitation-token",
    organizationName: "Northstar Finance",
    email: "employee@example.com",
    expiresAt: new Date(generatedAt.getTime() + 7 * 24 * 60 * 60_000),
    generatedAt,
  }).html,
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  Object.entries(previews).map(([filename, html]) =>
    writeFile(join(outputDirectory, filename), html, "utf8"),
  ),
);

console.info(`Email previews written to ${outputDirectory}`);
