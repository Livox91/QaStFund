import { validateEnvironment } from "@/infrastructure/config/environment";
import { ApplicationError } from "@/shared/errors/application-error";

export function getApplicationUrl(path: string): URL {
  return new URL(path, validateEnvironment().APP_URL);
}

export function assertTrustedRequestOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(validateEnvironment().APP_URL).origin;

  if (origin !== expectedOrigin) {
    throw new ApplicationError(
      "INVALID_REQUEST_ORIGIN",
      "The request origin is invalid.",
      403,
    );
  }
}
