import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { InvalidCredentialsError } from "@/modules/auth/application/errors/auth-errors";
import { getRoleHome } from "@/modules/auth/domain/application-role";
import { AUTH_SESSION_COOKIE } from "@/modules/auth/domain/session";
import {
  signInWithPassword,
  signOutSession,
} from "@/modules/auth/infrastructure/auth-service";
import { signInSchema } from "@/modules/auth/schemas/sign-in.schema";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";

export const runtime = "nodejs";

function signInRedirect(request: Request, error?: string): URL {
  const url = new URL("/sign-in", request.url);

  if (error) {
    url.searchParams.set("error", error);
  }

  return url;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);

    const formData = await request.formData();
    const parsedInput = signInSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    if (!parsedInput.success) {
      return NextResponse.redirect(
        signInRedirect(request, "invalid_input"),
        303,
      );
    }

    const existingSessionToken =
      request.cookies.get(AUTH_SESSION_COOKIE)?.value;

    await signOutSession(existingSessionToken);

    const authentication = await signInWithPassword(parsedInput.data);
    const response = NextResponse.redirect(
      new URL(getRoleHome(authentication.actor.role), request.url),
      303,
    );

    response.cookies.set(AUTH_SESSION_COOKIE, authentication.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: authentication.expiresAt,
    });

    return response;
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return NextResponse.redirect(
        signInRedirect(request, "invalid_credentials"),
        303,
      );
    }

    logger.error("Sign-in failed", error);
    return NextResponse.redirect(
      signInRedirect(request, "sign_in_failed"),
      303,
    );
  }
}
