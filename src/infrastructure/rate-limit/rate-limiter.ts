export type RateLimitPolicy = Readonly<{
  action: string;
  limit: number;
  windowMs: number;
}>;

export type RateLimitConsumption = Readonly<{
  identityHash: string;
  action: string;
  windowStart: Date;
  expiresAt: Date;
}>;

export interface RateLimitStore {
  consume(input: RateLimitConsumption): Promise<number>;
}

export type RateLimitResult = Readonly<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: Date;
}>;

export async function consumeRateLimit(
  store: RateLimitStore,
  identityHash: string,
  policy: RateLimitPolicy,
  now = new Date(),
): Promise<RateLimitResult> {
  if (!Number.isInteger(policy.limit) || policy.limit < 1) {
    throw new Error("Rate-limit policy limit must be a positive integer.");
  }
  if (!Number.isInteger(policy.windowMs) || policy.windowMs < 1) {
    throw new Error("Rate-limit policy window must be a positive integer.");
  }

  const windowStartMs =
    Math.floor(now.getTime() / policy.windowMs) * policy.windowMs;
  const windowStart = new Date(windowStartMs);
  const resetAt = new Date(windowStartMs + policy.windowMs);
  const requestCount = await store.consume({
    identityHash,
    action: policy.action,
    windowStart,
    expiresAt: resetAt,
  });
  const allowed = requestCount <= policy.limit;

  return {
    allowed,
    remaining: Math.max(0, policy.limit - requestCount),
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
    resetAt,
  };
}
