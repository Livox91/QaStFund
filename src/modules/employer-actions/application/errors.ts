import { ApplicationError } from "@/shared/errors/application-error";

export class EmployerActionTargetNotFoundError extends ApplicationError {
  constructor() {
    super(
      "EMPLOYER_ACTION_TARGET_NOT_FOUND",
      "The loan is not available for this employer action.",
      404,
    );
  }
}

export class EmployerActionNotAllowedError extends ApplicationError {
  constructor() {
    super(
      "EMPLOYER_ACTION_NOT_ALLOWED",
      "This action is not allowed for the loan's current state.",
      409,
    );
  }
}

export class EmployerActionIdempotencyConflictError extends ApplicationError {
  constructor() {
    super(
      "EMPLOYER_ACTION_IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used for a different action.",
      409,
    );
  }
}
