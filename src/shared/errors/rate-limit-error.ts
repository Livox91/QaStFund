import { ApplicationError } from "@/shared/errors/application-error";

export class RateLimitExceededError extends ApplicationError {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      "RATE_LIMITED",
      "Too many requests. Try again after the indicated delay.",
      429,
    );
  }
}
