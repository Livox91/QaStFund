-- Refuse to install the guards over ambiguous live state. Operators must first
-- reconcile any duplicates rather than having the migration choose a winner.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Loan"
    WHERE "status" = 'REQUESTED' AND "lendingOfferId" IS NOT NULL
    GROUP BY "organizationId", "lendingOfferId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate active lending acceptance intents exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "LoanRepayment"
    WHERE "status" = 'PENDING'
    GROUP BY "organizationId", "loanId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate active repayment intents exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "Loan_one_requested_acceptance_per_offer"
ON "Loan" ("organizationId", "lendingOfferId")
WHERE "status" = 'REQUESTED' AND "lendingOfferId" IS NOT NULL;

CREATE UNIQUE INDEX "LoanRepayment_one_pending_per_loan"
ON "LoanRepayment" ("organizationId", "loanId")
WHERE "status" = 'PENDING';
