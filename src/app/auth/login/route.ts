import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import {
  enforceLoginAccountRateLimit,
  enforcePublicRateLimit,
} from "@/infrastructure/rate-limit/rate-limit";
import { InvalidAuthenticationInputError } from "@/modules/auth/application/errors/auth-errors";
import { toCurrentSession } from "@/modules/auth/domain/current-session";
import { AUTH_SESSION_COOKIE } from "@/modules/auth/domain/session";
import {
  signInWithPassword,
  signOutSession,
} from "@/modules/auth/infrastructure/auth-service";
import { setSessionCookie } from "@/modules/auth/infrastructure/session-cookie";
import { signInSchema } from "@/modules/auth/schemas/sign-in.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    await enforcePublicRateLimit(request, "auth.login.ip");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new InvalidAuthenticationInputError();
    }

    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) throw new InvalidAuthenticationInputError();

    await enforceLoginAccountRateLimit(parsed.data.email);
    const authentication = await signInWithPassword(parsed.data);
    await signOutSession(request.cookies.get(AUTH_SESSION_COOKIE)?.value);

    const response = apiSuccess({
      session: toCurrentSession(authentication.actor),
    });
    setSessionCookie(
      response,
      authentication.sessionToken,
      authentication.expiresAt,
    );
    return response;
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Login failed", error);
    }
    return apiError(error);
  }
}
