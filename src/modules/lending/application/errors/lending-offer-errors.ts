import { ApplicationError } from "@/shared/errors/application-error";

export class InvalidLendingOfferTermsError extends ApplicationError {
  constructor() {
    super(
      "INVALID_LENDING_OFFER_TERMS",
      "The lending offer terms are invalid.",
      422,
    );
  }
}

export class LendingOfferNotFoundError extends ApplicationError {
  constructor() {
    super("LENDING_OFFER_NOT_FOUND", "Lending offer was not found.", 404);
  }
}

export class InvalidLendingOfferStatusTransitionError extends ApplicationError {
  constructor() {
    super(
      "INVALID_LENDING_OFFER_STATUS_TRANSITION",
      "The lending offer cannot move to the requested status.",
      409,
    );
  }
}
