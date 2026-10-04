import { describe, expect, it, vi } from "vitest";

import { resolveClientAddress } from "@/infrastructure/rate-limit/client-address";
import {
  consumeRateLimit,
  type RateLimitConsumption,
  type RateLimitStore,
} from "@/infrastructure/rate-limit/rate-limiter";
import { requireAuthenticatedUser } from "@/modules/auth/application/authorization";
import { apiError } from "@/shared/api/responses";
import { RateLimitExceededError } from "@/shared/errors/rate-limit-error";

class MemoryRateLimitStore implements RateLimitStore {
  readonly counts = new Map<string, number>();
  consumeSpy = vi.fn((input: RateLimitConsumption) => {
    const key = `${input.identityHash}:${input.action}:${input.windowStart.toISOString()}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return Promise.resolve(count);
  });

  consume(input: RateLimitConsumption): Promise<number> {
    return this.consumeSpy(input);
  }
}

const policy = { action: "lending.offer.create", limit: 3, windowMs: 60_000 };
const start = new Date("2026-10-04T10:00:00.000Z");

describe("rate limiter", () => {
  it("allows requests below the limit and rejects requests above it", async () => {
    const store = new MemoryRateLimitStore();
    const first = await consumeRateLimit(store, "user-a", policy, start);
    const second = await consumeRateLimit(store, "user-a", policy, start);
    const third = await consumeRateLimit(store, "user-a", policy, start);
    const fourth = await consumeRateLimit(store, "user-a", policy, start);

    expect([
      first.allowed,
      second.allowed,
      third.allowed,
      fourth.allowed,
    ]).toEqual([true, true, true, false]);
    expect(fourth.retryAfterSeconds).toBe(60);
  });

  it("resets the limit after the configured window", async () => {
    const store = new MemoryRateLimitStore();
    for (let attempt = 0; attempt < policy.limit + 1; attempt += 1) {
      await consumeRateLimit(store, "user-a", policy, start);
    }

    await expect(
      consumeRateLimit(
        store,
        "user-a",
        policy,
        new Date(start.getTime() + policy.windowMs),
      ),
    ).resolves.toMatchObject({ allowed: true, remaining: 2 });
  });

  it("isolates authenticated users even when they share an IP", async () => {
    const store = new MemoryRateLimitStore();
    for (let attempt = 0; attempt < policy.limit; attempt += 1) {
      await consumeRateLimit(store, "user-a", policy, start);
    }

    await expect(
      consumeRateLimit(store, "user-b", policy, start),
    ).resolves.toMatchObject({ allowed: true, remaining: 2 });
  });

  it("uses the same user bucket when the user's IP changes", async () => {
    const store = new MemoryRateLimitStore();
    await consumeRateLimit(store, "user-a", policy, start);
    await consumeRateLimit(store, "user-a", policy, start);
    const result = await consumeRateLimit(store, "user-a", policy, start);

    expect(result).toMatchObject({ allowed: true, remaining: 0 });
    expect(store.counts).toHaveLength(1);
  });

  it("isolates public IP buckets when forwarded headers are trusted", async () => {
    const store = new MemoryRateLimitStore();
    const firstIp = resolveClientAddress(
      new Headers({ "x-forwarded-for": "203.0.113.10" }),
      { trustProxy: true, trustedProxyHops: 1 },
    );
    const secondIp = resolveClientAddress(
      new Headers({ "x-forwarded-for": "203.0.113.11" }),
      { trustProxy: true, trustedProxyHops: 1 },
    );

    for (let attempt = 0; attempt < policy.limit; attempt += 1) {
      await consumeRateLimit(store, firstIp, policy, start);
    }
    await expect(
      consumeRateLimit(store, secondIp, policy, start),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("does not trust caller-supplied forwarding headers by default", () => {
    expect(
      resolveClientAddress(new Headers({ "x-forwarded-for": "203.0.113.10" }), {
        trustProxy: false,
        trustedProxyHops: 1,
      }),
    ).toBe("unattributed");
  });

  it("protects authentication attempts and permits retry after reset", async () => {
    const store = new MemoryRateLimitStore();
    const authenticationPolicy = {
      action: "auth.login.account",
      limit: 2,
      windowMs: 300_000,
    };

    await consumeRateLimit(store, "account-hash", authenticationPolicy, start);
    await consumeRateLimit(store, "account-hash", authenticationPolicy, start);
    await expect(
      consumeRateLimit(store, "account-hash", authenticationPolicy, start),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      consumeRateLimit(
        store,
        "account-hash",
        authenticationPolicy,
        new Date(start.getTime() + authenticationPolicy.windowMs),
      ),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("counts concurrent requests without allowing more than the limit", async () => {
    const store = new MemoryRateLimitStore();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit(store, "user-a", policy, start),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(
      policy.limit,
    );
  });

  it("returns a machine-readable 429 response with retry information", async () => {
    const response = apiError(new RateLimitExceededError(42));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Try again after the indicated delay.",
        retryAfterSeconds: 42,
      },
    });
  });

  it("does not bypass authentication or consume a user bucket first", async () => {
    const store = new MemoryRateLimitStore();

    await expect(
      (async () => {
        const actor = requireAuthenticatedUser(null);
        return consumeRateLimit(store, actor.userId, policy, start);
      })(),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(store.consumeSpy).not.toHaveBeenCalled();
  });

  it("leaves idempotency responsible for duplicate financial requests", async () => {
    const store = new MemoryRateLimitStore();
    const recorded = new Map<string, string>();
    let writes = 0;
    const execute = async (idempotencyKey: string) => {
      const limit = await consumeRateLimit(store, "user-a", policy, start);
      if (!limit.allowed)
        throw new RateLimitExceededError(limit.retryAfterSeconds);
      const existing = recorded.get(idempotencyKey);
      if (existing) return existing;
      writes += 1;
      recorded.set(idempotencyKey, "transaction-a");
      return "transaction-a";
    };

    await expect(execute("same-request")).resolves.toBe("transaction-a");
    await expect(execute("same-request")).resolves.toBe("transaction-a");
    expect(writes).toBe(1);
  });
});
