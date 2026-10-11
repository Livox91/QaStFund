ALTER TABLE "LoanOriginationDecision"
  ALTER COLUMN "reasonCodes" SET NOT NULL,
  ADD CONSTRAINT "LoanOriginationDecision_score_check"
    CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100));

ALTER TABLE "LoanOriginationOverride"
  ADD CONSTRAINT "LoanOriginationOverride_rationale_check"
    CHECK (length(btrim("rationale")) >= 20);
