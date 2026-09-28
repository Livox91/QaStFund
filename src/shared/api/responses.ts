import { NextResponse } from "next/server";

import { ApplicationError } from "@/shared/errors/application-error";
import type { ApiError } from "@/shared/types/api";

export function apiSuccess<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status });
}

export function apiError(error: unknown): NextResponse<ApiError> {
  if (error instanceof ApplicationError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.statusCode },
    );
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
