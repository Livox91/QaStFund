-- A reviewer-approved Arc application remains unresolved until its on-chain
-- offer acceptance is confirmed. Keep both REQUESTED and on-chain APPROVED
-- applications inside the same concurrency boundaries. Legacy APPROVED loans
-- have no contract address and are intentionally excluded from this expansion.
DROP INDEX "Loan_one_requested_acceptance_per_offer";

CREATE UNIQUE INDEX "Loan_one_unresolved_acceptance_per_offer"
ON "Loan" ("organizationId", "lendingOfferId")
WHERE "lendingOfferId" IS NOT NULL
  AND (
    "status" = 'REQUESTED'
    OR ("status" = 'APPROVED' AND "contractAddress" IS NOT NULL)
  );

DROP INDEX "Loan_one_requested_per_borrower_idx";

CREATE UNIQUE INDEX "Loan_one_unresolved_per_borrower_idx"
ON "Loan" ("organizationId", "borrowerMembershipId")
WHERE "status" = 'REQUESTED'
   OR ("status" = 'APPROVED' AND "contractAddress" IS NOT NULL);
