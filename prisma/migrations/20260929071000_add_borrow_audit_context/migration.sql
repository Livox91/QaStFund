ALTER TABLE "AuditEvent"
  ADD COLUMN "lendingOfferId" UUID,
  ADD COLUMN "amountMinorUnits" BIGINT,
  ADD COLUMN "currency" VARCHAR(3),
  ADD CONSTRAINT "AuditEvent_amount_check"
    CHECK ("amountMinorUnits" IS NULL OR "amountMinorUnits" > 0),
  ADD CONSTRAINT "AuditEvent_currency_format_check"
    CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');

CREATE INDEX "AuditEvent_organizationId_lendingOfferId_occurredAt_idx"
  ON "AuditEvent"("organizationId", "lendingOfferId", "occurredAt");

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_organizationId_lendingOfferId_fkey"
  FOREIGN KEY ("organizationId", "lendingOfferId")
  REFERENCES "LendingOffer"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
