import "server-only";

import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

/** Shared envelope for employee-facing repayment agent routes. */
export async function handleAgentRoute<T>(
  request: NextRequest,
  options: Readonly<{
    rateLimitKey: string;
    mutation: boolean;
    run: (actor: AuthenticatedActor) => Promise<T>;
    status?: number;
  }>,
): Promise<Response> {
  try {
    if (options.mutation) assertTrustedRequestOrigin(request);
    const actor = requireEmployee(await getCurrentActor());
    await enforceUserRateLimit(
      actor,
      options.rateLimitKey,
      options.mutation ? "sensitive" : "expensive",
    );
    return apiSuccess(await options.run(actor), options.status ?? 200);
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Repayment agent route failed", error, {
        route: options.rateLimitKey,
      });
    }
    return apiError(error);
  }
}

export async function readJson<T>(
  request: NextRequest,
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false };
  },
): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new ApplicationError(
      "INVALID_REQUEST",
      "The request is invalid.",
      400,
    );
  }
  return parsed.data;
}
