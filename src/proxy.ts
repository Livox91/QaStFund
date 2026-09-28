import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_SESSION_COOKIE } from "@/modules/auth/domain/session";

export function proxy(request: NextRequest): NextResponse {
  if (!request.cookies.has(AUTH_SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/employer/:path*", "/profile"],
};
