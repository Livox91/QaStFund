import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma";
import { PrismaRateLimitStore } from "@/infrastructure/rate-limit/prisma-rate-limit-store";
import { consumeRateLimit } from "@/infrastructure/rate-limit/rate-limiter";

const identityHash = randomUUID().replaceAll("-", "").padEnd(64, "0");

describe("PostgreSQL rate-limit store", () => {
  afterAll(async () => {
    await prisma.rateLimitBucket.deleteMany({ where: { identityHash } });
    await prisma.$disconnect();
  });

  it("atomically enforces a sensitive-operation limit under concurrency", async () => {
    const store = new PrismaRateLimitStore();
    const policy = {
      action: "lending.offer.create",
      limit: 10,
      windowMs: 60_000,
    };
    const now = new Date("2026-10-04T10:00:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        consumeRateLimit(store, identityHash, policy, now),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(
      policy.limit,
    );
    await expect(
      prisma.rateLimitBucket.findUnique({
        where: {
          identityHash_action_windowStart: {
            identityHash,
            action: policy.action,
            windowStart: now,
          },
        },
      }),
    ).resolves.toMatchObject({ requestCount: 30 });
  });
});
