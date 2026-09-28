import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { AUTH_SESSION_COOKIE } from "@/modules/auth/domain/session";
import { signOutSession } from "@/modules/auth/infrastructure/auth-service";
import { apiError } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    const sessionToken = request.cookies.get(AUTH_SESSION_COOKIE)?.value;

    await signOutSession(sessionToken);
  } catch (error) {
    logger.error("Sign-out failed", error);

    return apiError(
      error instanceof ApplicationError
        ? error
        : new ApplicationError(
            "SIGN_OUT_FAILED",
            "Unable to sign out right now.",
            500,
          ),
    );
  }

  const response = NextResponse.redirect(new URL("/sign-in", request.url), 303);
  response.cookies.set(AUTH_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
