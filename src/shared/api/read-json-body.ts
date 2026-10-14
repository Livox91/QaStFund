import { ApplicationError } from "@/shared/errors/application-error";

const MAX_JSON_BODY_BYTES = 4_096;

export async function readLimitedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_JSON_BODY_BYTES
  ) {
    throw new ApplicationError(
      "REQUEST_BODY_TOO_LARGE",
      "The request body is too large.",
      413,
    );
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new ApplicationError(
      "REQUEST_BODY_TOO_LARGE",
      "The request body is too large.",
      413,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApplicationError(
      "INVALID_JSON",
      "The request body must be valid JSON.",
      400,
    );
  }
}
