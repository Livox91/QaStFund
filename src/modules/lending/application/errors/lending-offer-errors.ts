import { ApplicationError } from "@/shared/errors/application-error";

export class InsufficientMockBalanceError extends ApplicationError {
  constructor() {
    super(
      "INSUFFICIENT_MOCK_BALANCE",
      "The offer amount exceeds your available balance.",
      422,
    );
  }
}

export class InvalidLendingOfferTermsError extends ApplicationError {
  constructor() {
    super(
      "INVALID_LENDING_OFFER_TERMS",
      "The lending offer terms are invalid.",
      422,
    );
  }
}
