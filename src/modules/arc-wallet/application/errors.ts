import { ApplicationError } from "@/shared/errors/application-error";

export class ArcWalletNotAvailableError extends ApplicationError {
  constructor() {
    super("ARC_WALLET_NOT_AVAILABLE", "Arc wallet is not configured.", 404);
  }
}

export class ArcWalletConflictError extends ApplicationError {
  constructor(
    message = "An Arc wallet is already associated with this employee.",
  ) {
    super("ARC_WALLET_CONFLICT", message, 409);
  }
}

export class ArcWalletChallengeError extends ApplicationError {
  constructor(
    message = "The wallet verification challenge is invalid or expired.",
  ) {
    super("ARC_WALLET_CHALLENGE_INVALID", message, 400);
  }
}

export class ArcWalletOwnershipError extends ApplicationError {
  constructor() {
    super(
      "ARC_WALLET_OWNERSHIP_NOT_VERIFIED",
      "The Circle wallet ownership signature could not be verified.",
      400,
    );
  }
}

export class ArcWalletProviderError extends ApplicationError {
  constructor(cause?: unknown) {
    super(
      "ARC_WALLET_PROVIDER_ERROR",
      "Circle or Arc could not verify the wallet.",
      502,
      { cause },
    );
  }
}
