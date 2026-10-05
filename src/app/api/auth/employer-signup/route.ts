import { randomBytes } from "node:crypto";

import type { NextRequest } from "next/server";

import { logger } from "@/infrastructure/logging/logger";
import { enforcePublicRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { InvalidAuthenticationInputError } from "@/modules/auth/application/errors/auth-errors";
import { toCurrentSession } from "@/modules/auth/domain/current-session";
import { AUTH_SESSION_COOKIE } from "@/modules/auth/domain/session";
import {
  registerOrganization,
  signOutSession,
} from "@/modules/auth/infrastructure/auth-service";
import { setSessionCookie } from "@/modules/auth/infrastructure/session-cookie";
import { employerSignupSchema } from "@/modules/auth/schemas/register.schema";
import { apiError, apiSuccess } from "@/shared/api/responses";
import { assertTrustedRequestOrigin } from "@/shared/api/request-origin";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";

function organizationSlug(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${base || "organization"}-${randomBytes(4).toString("hex")}`;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertTrustedRequestOrigin(request);
    await enforcePublicRateLimit(
      request,
      "auth.employer-registration",
      "authentication",
    );
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new InvalidAuthenticationInputError();
    }
    const parsed = employerSignupSchema.safeParse(body);
    if (!parsed.success) throw new InvalidAuthenticationInputError();

    const authentication = await registerOrganization({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      organizationName: parsed.data.organizationName,
      organizationSlug: organizationSlug(parsed.data.organizationName),
      erpNextEnabled: true,
    });
    await signOutSession(request.cookies.get(AUTH_SESSION_COOKIE)?.value);

    const response = apiSuccess(
      { session: toCurrentSession(authentication.actor) },
      201,
    );
    setSessionCookie(
      response,
      authentication.sessionToken,
      authentication.expiresAt,
    );
    return response;
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Employer registration failed", error);
    }
    return apiError(error);
  }
}
