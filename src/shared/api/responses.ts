import { NextResponse } from "next/server";

import { incrementOperationalCounter } from "@/infrastructure/observability/operational-signals";
import { ApplicationError } from "@/shared/errors/application-error";
import { RateLimitExceededError } from "@/shared/errors/rate-limit-error";
import type { ApiError } from "@/shared/types/api";

export function apiSuccess<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status });
}

export function apiError(error: unknown): NextResponse<ApiError> {
  incrementOperationalCounter("api_errors_total");
  if (error instanceof ApplicationError) {
    const response = NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error instanceof RateLimitExceededError
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
        },
      },
      { status: error.statusCode },
    );
    if (error instanceof RateLimitExceededError) {
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
      response.headers.set("Cache-Control", "no-store");
    }
    return response;
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    },
    { status: 500 },
  );
}
