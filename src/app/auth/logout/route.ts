import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { AUTH_SESSION_COOKIE } from "@/modules/auth/domain/session";
import { signOutSession } from "@/modules/auth/infrastructure/auth-service";
import { clearSessionCookie } from "@/modules/auth/infrastructure/session-cookie";
import { apiError } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    await signOutSession(request.cookies.get(AUTH_SESSION_COOKIE)?.value);

    const response = new NextResponse(null, { status: 204 });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Logout failed", error);
    }
    return apiError(error);
  }
}
