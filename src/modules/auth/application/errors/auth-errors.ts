import { ApplicationError } from "@/shared/errors/application-error";

export class InvalidCredentialsError extends ApplicationError {
  constructor() {
    super("INVALID_CREDENTIALS", "Invalid email or password.", 401);
  }
}

export class AccountMembershipRequiredError extends ApplicationError {
  constructor() {
    super(
      "ACCOUNT_MEMBERSHIP_REQUIRED",
      "This account requires exactly one active organization membership.",
      403,
    );
  }
}

export class UnauthenticatedError extends ApplicationError {
  constructor() {
    super("UNAUTHENTICATED", "Authentication is required.", 401);
  }
}

export class ForbiddenError extends ApplicationError {
  constructor() {
    super(
      "FORBIDDEN",
      "You do not have permission to perform this action.",
      403,
    );
  }
}

export class OrganizationNotFoundError extends ApplicationError {
  constructor() {
    super("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
  }
}
