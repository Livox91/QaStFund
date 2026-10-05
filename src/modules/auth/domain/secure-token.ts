import { createHash, randomBytes } from "node:crypto";

export function generateSecureToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSecureToken(token) };
}

export function hashSecureToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
