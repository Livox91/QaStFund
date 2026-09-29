import { ApplicationError } from "@/shared/errors/application-error";

export class WalletNotFoundError extends ApplicationError {
  constructor() {
    super("WALLET_NOT_FOUND", "The employee wallet was not found.", 404);
  }
}

export class InsufficientWalletBalanceError extends ApplicationError {
  constructor() {
    super(
      "INSUFFICIENT_WALLET_BALANCE",
      "The wallet does not have enough available USDC.",
      409,
    );
  }
}

export class InvalidFundingAmountError extends ApplicationError {
  constructor() {
    super("INVALID_FUNDING_AMOUNT", "Enter a valid funding amount.", 422);
  }
}

export class LedgerPostingError extends Error {}
