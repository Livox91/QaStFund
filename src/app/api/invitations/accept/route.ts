import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { enforcePublicRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { AUTH_SESSION_COOKIE } from "@/modules/auth/domain/session";
import { setSessionCookie } from "@/modules/auth/infrastructure/session-cookie";
import { passwordConfirmationSchema } from "@/modules/auth/schemas/password.schema";
import { acceptInvitation } from "@/modules/employee-invitations/infrastructure/invitation-service";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";

const schema = passwordConfirmationSchema.extend({
  token: z.string().min(32).max(256),
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export async function POST(request: NextRequest) {
  try {
    assertTrustedRequestOrigin(request);
    await enforcePublicRateLimit(
      request,
      "auth.invitation.accept",
      "authentication",
    );
    const data = schema.parse(Object.fromEntries(await request.formData()));
    const authentication = await acceptInvitation({
      token: data.token,
      email: data.email,
      password: data.password,
    });
    const response = NextResponse.redirect(new URL("/app", request.url), 303);
    response.cookies.delete(AUTH_SESSION_COOKIE);
    setSessionCookie(
      response,
      authentication.sessionToken,
      authentication.expiresAt,
    );
    return response;
  } catch {
    return NextResponse.redirect(
      new URL("/sign-in?error=invitation_failed", request.url),
      303,
    );
  }
}
