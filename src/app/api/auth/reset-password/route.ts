import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforcePublicRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { passwordConfirmationSchema } from "@/modules/auth/schemas/password.schema";
import { resetPassword } from "@/modules/employee-invitations/infrastructure/invitation-service";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";

const schema = passwordConfirmationSchema.extend({
  token: z.string().min(32).max(256),
});
export async function POST(request: NextRequest) {
  try {
    assertTrustedRequestOrigin(request);
    await enforcePublicRateLimit(
      request,
      "auth.password-reset.complete",
      "authentication",
    );
    const data = schema.parse(Object.fromEntries(await request.formData()));
    await resetPassword({ token: data.token, password: data.password });
    return NextResponse.redirect(
      new URL("/sign-in?password=reset", request.url),
      303,
    );
  } catch {
    return NextResponse.redirect(
      new URL("/sign-in?error=reset_failed", request.url),
      303,
    );
  }
}
