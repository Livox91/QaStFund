import "server-only";

import { randomUUID } from "node:crypto";

import { prisma } from "@/infrastructure/database/prisma";
import type {
  RateLimitConsumption,
  RateLimitStore,
} from "@/infrastructure/rate-limit/rate-limiter";

export class PrismaRateLimitStore implements RateLimitStore {
  async consume(input: RateLimitConsumption): Promise<number> {
    const [row] = await prisma.$queryRaw<Array<{ requestCount: number }>>`
      WITH "expired" AS (
        SELECT "id"
        FROM "RateLimitBucket"
        WHERE "expiresAt" <= ${input.windowStart}
        ORDER BY "expiresAt"
        LIMIT 100
      ),
      "cleanup" AS (
        DELETE FROM "RateLimitBucket"
        WHERE "id" IN (SELECT "id" FROM "expired")
      ),
      "consumed" AS (
        INSERT INTO "RateLimitBucket" (
          "id",
          "identityHash",
          "action",
          "windowStart",
          "requestCount",
          "expiresAt",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          CAST(${randomUUID()} AS UUID),
          ${input.identityHash},
          ${input.action},
          ${input.windowStart},
          1,
          ${input.expiresAt},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("identityHash", "action", "windowStart")
        DO UPDATE SET
          "requestCount" = "RateLimitBucket"."requestCount" + 1,
          "expiresAt" = EXCLUDED."expiresAt",
          "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "requestCount"
      )
      SELECT "requestCount" FROM "consumed"
    `;

    if (!row) throw new Error("Rate-limit counter did not return a result.");
    return row.requestCount;
  }
}

export const prismaRateLimitStore = new PrismaRateLimitStore();
