import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { validateEnvironment } from "@/infrastructure/config/environment";
import {
  enforceLoginAccountRateLimit,
  enforcePublicRateLimit,
} from "@/infrastructure/rate-limit/rate-limit";
import { requestPasswordReset } from "@/modules/employee-invitations/infrastructure/invitation-service";
import { emailSender } from "@/modules/notifications/infrastructure/http-email-sender";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";

export async function POST(request: NextRequest) {
  try {
    assertTrustedRequestOrigin(request);
    await enforcePublicRateLimit(
      request,
      "auth.password-reset.request",
      "authentication",
    );
    const email = z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email())
      .parse((await request.formData()).get("email"));
    await enforceLoginAccountRateLimit(email);
    await requestPasswordReset({
      email,
      sender: emailSender,
      appUrl: validateEnvironment().APP_URL,
    });
  } catch {
    /* Always return the same response to prevent enumeration. */
  }
  return NextResponse.redirect(
    new URL("/forgot-password?sent=1", request.url),
    303,
  );
}
