import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { SessionTokenService } from "@/modules/auth/application/ports/session-token-service";

export const secureSessionTokenService: SessionTokenService = {
  generate(): string {
    return randomBytes(32).toString("base64url");
  },

  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  },
};
