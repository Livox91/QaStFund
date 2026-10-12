-- Financial rows are an authoritative safety boundary. Refuse invalid money
-- states even if a future application path omits its domain validation.
ALTER TABLE "LendingOffer"
  ADD CONSTRAINT "LendingOffer_amount_positive_check"
    CHECK ("amountMinorUnits" > 0),
  ADD CONSTRAINT "LendingOffer_available_capacity_check"
    CHECK (
      "availableAmountMinorUnits" >= 0
      AND "availableAmountMinorUnits" <= "amountMinorUnits"
    ),
  ADD CONSTRAINT "LendingOffer_loan_bounds_check"
    CHECK (
      "minimumLoanAmountMinorUnits" > 0
      AND "maximumLoanAmountMinorUnits" >= "minimumLoanAmountMinorUnits"
      AND "maximumLoanAmountMinorUnits" <= "amountMinorUnits"
    );

-- LendingOffer_terms_check was created by
-- 20260929030000_add_lending_offer_creation. It already enforces duration and
-- fee bounds, as well as expiry ordering, so it must not be redefined here.

ALTER TABLE "Loan"
  ADD CONSTRAINT "Loan_financial_terms_check"
    CHECK (
      "principalAmountMinorUnits" > 0
      AND "feeAmountMinorUnits" >= 0
      AND "outstandingPrincipalMinorUnits" >= 0
      AND "outstandingPrincipalMinorUnits" <= "principalAmountMinorUnits"
      AND "durationDays" > 0
      AND "feeRateBasisPoints" >= 0
      AND "feeRateBasisPoints" <= 10000
    );

ALTER TABLE "LoanRepayment"
  ADD COLUMN "submissionTransactionHash" VARCHAR(66),
  ADD CONSTRAINT "LoanRepayment_amount_positive_check"
    CHECK ("amountMinorUnits" > 0);

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_amount_positive_check"
    CHECK ("amountMinorUnits" > 0);

-- A canonical escrow identifier may be observed through multiple callbacks,
-- but it may describe only one application record.
CREATE UNIQUE INDEX "LendingOffer_contractAddress_chainOfferId_key"
  ON "LendingOffer"("contractAddress", "chainOfferId");

CREATE UNIQUE INDEX "LoanRepayment_submissionTransactionHash_key"
  ON "LoanRepayment"("submissionTransactionHash");
