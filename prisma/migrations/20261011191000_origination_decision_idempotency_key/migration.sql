ALTER TABLE "LoanOriginationDecision"
ADD COLUMN "idempotencyKey" VARCHAR(128);

UPDATE "LoanOriginationDecision"
SET "idempotencyKey" = "loanId"::text || ':' || "modelVersion";

ALTER TABLE "LoanOriginationDecision"
ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX "LoanOriginationDecision_idempotencyKey_key"
ON "LoanOriginationDecision"("idempotencyKey");
