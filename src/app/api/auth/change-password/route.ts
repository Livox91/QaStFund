import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { AUTH_SESSION_COOKIE } from "@/modules/auth/domain/session";
import { securePasswordSchema } from "@/modules/auth/schemas/password.schema";
import { changePassword } from "@/modules/employee-invitations/infrastructure/invitation-service";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";

const schema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: securePasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
  });
export async function POST(request: NextRequest) {
  try {
    assertTrustedRequestOrigin(request);
    const actor = await getCurrentActor();
    if (!actor) throw new Error("UNAUTHENTICATED");
    await enforceUserRateLimit(actor, "auth.password.change", "sensitive");
    const data = schema.parse(Object.fromEntries(await request.formData()));
    await changePassword({
      actor,
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
      currentSessionToken: request.cookies.get(AUTH_SESSION_COOKIE)?.value,
    });
    return NextResponse.redirect(
      new URL("/profile?password=changed", request.url),
      303,
    );
  } catch {
    return NextResponse.redirect(
      new URL("/profile?password=failed", request.url),
      303,
    );
  }
}
