ALTER TABLE "LoanRepaymentPlan"
DROP CONSTRAINT "LoanRepaymentPlan_approval_check";

ALTER TABLE "LoanRepaymentPlan"
ADD CONSTRAINT "LoanRepaymentPlan_activation_check" CHECK (
  (
    "status" = 'ACTIVE'
    AND "borrowerConsentedAt" IS NOT NULL
    AND "effectiveAt" IS NOT NULL
    AND (
      ("approvedByMembershipId" IS NULL AND "approvedAt" IS NULL)
      OR ("approvedByMembershipId" IS NOT NULL AND "approvedAt" IS NOT NULL)
    )
  )
  OR "status" <> 'ACTIVE'
);
