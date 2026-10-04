import "server-only";

import { createHmac } from "node:crypto";

import { validateEnvironment } from "@/infrastructure/config/environment";
import { logger } from "@/infrastructure/logging/logger";
import { incrementOperationalCounter } from "@/infrastructure/observability/operational-signals";
import { resolveClientAddress } from "@/infrastructure/rate-limit/client-address";
import { prismaRateLimitStore } from "@/infrastructure/rate-limit/prisma-rate-limit-store";
import {
  consumeRateLimit,
  type RateLimitPolicy,
} from "@/infrastructure/rate-limit/rate-limiter";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { RateLimitExceededError } from "@/shared/errors/rate-limit-error";

export type RateLimitCategory =
  "authentication" | "public" | "sensitive" | "administrative" | "expensive";

function policy(action: string, category: RateLimitCategory): RateLimitPolicy {
  const environment = validateEnvironment();
  const limits = {
    authentication: environment.RATE_LIMIT_AUTH_MAX,
    public: environment.RATE_LIMIT_PUBLIC_MAX,
    sensitive: environment.RATE_LIMIT_SENSITIVE_MAX,
    administrative: environment.RATE_LIMIT_ADMIN_MAX,
    expensive: environment.RATE_LIMIT_EXPENSIVE_MAX,
  } satisfies Record<RateLimitCategory, number>;

  return {
    action,
    limit: limits[category],
    windowMs: environment.RATE_LIMIT_WINDOW_SECONDS * 1000,
  };
}

function hashIdentity(scope: string, identity: string): string {
  const environment = validateEnvironment();
  const key = environment.RATE_LIMIT_HASH_SECRET ?? environment.DATABASE_URL;
  return createHmac("sha256", key).update(`${scope}:${identity}`).digest("hex");
}

async function enforce(
  scope: "account" | "ip" | "user",
  identity: string,
  action: string,
  category: RateLimitCategory,
): Promise<void> {
  const environment = validateEnvironment();
  if (!environment.RATE_LIMIT_ENABLED) return;

  const identityHash = hashIdentity(scope, identity);
  const result = await consumeRateLimit(
    prismaRateLimitStore,
    identityHash,
    policy(action, category),
  );
  if (result.allowed) return;

  incrementOperationalCounter("rate_limit_events_total");
  logger.warn("Rate limit exceeded", {
    action,
    scope,
    identityFingerprint: identityHash.slice(0, 12),
    retryAfterSeconds: result.retryAfterSeconds,
  });
  throw new RateLimitExceededError(result.retryAfterSeconds);
}

export async function enforcePublicRateLimit(
  request: Request,
  action: string,
  category: "authentication" | "public" = "public",
): Promise<void> {
  const environment = validateEnvironment();
  const address = resolveClientAddress(request.headers, {
    trustProxy: environment.RATE_LIMIT_TRUST_PROXY,
    trustedProxyHops: environment.RATE_LIMIT_TRUSTED_PROXY_HOPS,
  });
  await enforce("ip", address, action, category);
}

export async function enforceLoginAccountRateLimit(
  email: string,
): Promise<void> {
  await enforce(
    "account",
    email.trim().toLowerCase(),
    "auth.login.account",
    "authentication",
  );
}

export async function enforceUserRateLimit(
  actor: AuthenticatedActor,
  action: string,
  category: Exclude<RateLimitCategory, "authentication" | "public">,
): Promise<void> {
  await enforce("user", actor.userId, action, category);
}
