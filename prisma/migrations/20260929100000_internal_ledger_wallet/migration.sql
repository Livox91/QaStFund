ALTER TYPE "LedgerAccountType" RENAME VALUE 'MOCK_CASH' TO 'USER_WALLET';
ALTER TYPE "LedgerAccountType" ADD VALUE 'PLATFORM';

ALTER TYPE "LedgerTransactionType" ADD VALUE 'DEPOSIT' BEFORE 'LOAN_DISBURSEMENT';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'WITHDRAWAL';

CREATE TYPE "LedgerTransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');
CREATE TYPE "LedgerReferenceType" AS ENUM ('DEVELOPMENT_FUNDING', 'LOAN', 'REPAYMENT', 'WITHDRAWAL');

ALTER TABLE "LedgerAccount" RENAME COLUMN "currency" TO "asset";
ALTER TABLE "LedgerAccount" ALTER COLUMN "asset" TYPE VARCHAR(8);
ALTER TABLE "LedgerAccount" ALTER COLUMN "membershipId" DROP NOT NULL;

ALTER TABLE "LedgerEntry" RENAME COLUMN "currency" TO "asset";
ALTER TABLE "LedgerEntry" ALTER COLUMN "asset" TYPE VARCHAR(8);

ALTER TABLE "LedgerTransaction"
  ADD COLUMN "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "referenceType" "LedgerReferenceType",
  ADD COLUMN "referenceId" UUID,
  ADD COLUMN "idempotencyKey" VARCHAR(128),
  ADD COLUMN "completedAt" TIMESTAMP(3);

UPDATE "LedgerTransaction"
SET
  "status" = 'COMPLETED',
  "referenceType" = CASE
    WHEN "type" = 'LOAN_REPAYMENT' THEN 'REPAYMENT'::"LedgerReferenceType"
    ELSE 'LOAN'::"LedgerReferenceType"
  END,
  "referenceId" = CASE
    WHEN "type" = 'LOAN_REPAYMENT' THEN "repaymentId"
    ELSE "loanId"
  END,
  "idempotencyKey" = CASE
    WHEN "type" = 'LOAN_REPAYMENT' THEN 'legacy:repayment:' || "repaymentId"::text
    ELSE 'legacy:loan:' || "loanId"::text
  END,
  "completedAt" = "createdAt";

ALTER TABLE "LedgerTransaction"
  ALTER COLUMN "referenceType" SET NOT NULL,
  ALTER COLUMN "referenceId" SET NOT NULL,
  ALTER COLUMN "idempotencyKey" SET NOT NULL;

ALTER TABLE "LedgerTransaction" DROP CONSTRAINT IF EXISTS "LedgerTransaction_organizationId_loanId_fkey";
ALTER TABLE "LedgerTransaction" DROP CONSTRAINT IF EXISTS "LedgerTransaction_organizationId_repaymentId_fkey";
DROP INDEX IF EXISTS "LedgerTransaction_repaymentId_key";
DROP INDEX IF EXISTS "LedgerTransaction_organizationId_repaymentId_key";
DROP INDEX IF EXISTS "LedgerTransaction_organizationId_loanId_idx";
DROP INDEX IF EXISTS "LedgerTransaction_one_disbursement_per_loan_idx";
ALTER TABLE "LedgerTransaction" DROP COLUMN "currency", DROP COLUMN "loanId", DROP COLUMN "repaymentId";

DROP INDEX IF EXISTS "LedgerAccount_organizationId_membershipId_currency_type_key";
CREATE UNIQUE INDEX "LedgerAccount_organizationId_membershipId_asset_type_key"
  ON "LedgerAccount"("organizationId", "membershipId", "asset", "type");
CREATE UNIQUE INDEX "LedgerTransaction_organizationId_idempotencyKey_key"
  ON "LedgerTransaction"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "LedgerTransaction_organizationId_referenceType_referenceId_type_key"
  ON "LedgerTransaction"("organizationId", "referenceType", "referenceId", "type");
CREATE INDEX "LedgerTransaction_organizationId_referenceType_referenceId_idx"
  ON "LedgerTransaction"("organizationId", "referenceType", "referenceId");
CREATE UNIQUE INDEX "LedgerEntry_transactionId_accountId_direction_key"
  ON "LedgerEntry"("transactionId", "accountId", "direction");

INSERT INTO "LedgerAccount" (
  "id", "organizationId", "membershipId", "asset", "type", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), membership."organizationId", membership."id", 'USDC', 'USER_WALLET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "OrganizationMembership" AS membership
WHERE membership."role" = 'EMPLOYEE'
  AND NOT EXISTS (
    SELECT 1 FROM "LedgerAccount" AS account
    WHERE account."organizationId" = membership."organizationId"
      AND account."membershipId" = membership."id"
      AND account."asset" = 'USDC'
      AND account."type" = 'USER_WALLET'
  );

CREATE FUNCTION provision_employee_usdc_wallet() RETURNS trigger AS $$
BEGIN
  IF NEW."role" = 'EMPLOYEE' THEN
    INSERT INTO "LedgerAccount" (
      "id", "organizationId", "membershipId", "asset", "type", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), NEW."organizationId", NEW."id", 'USDC', 'USER_WALLET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    ) ON CONFLICT ("organizationId", "membershipId", "asset", "type") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrganizationMembership_provision_usdc_wallet"
AFTER INSERT OR UPDATE OF "role" ON "OrganizationMembership"
FOR EACH ROW EXECUTE FUNCTION provision_employee_usdc_wallet();

ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_completion_check" CHECK (
  ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
  OR ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
);

CREATE FUNCTION prevent_completed_ledger_entry_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_ledger_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM "LedgerTransaction"
      WHERE "id" = NEW."transactionId" AND "status" = 'COMPLETED'
    ) THEN
      RAISE EXCEPTION 'completed ledger entries are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "LedgerTransaction"
    WHERE "id" = OLD."transactionId" AND "status" = 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'completed ledger entries are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_completed_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION prevent_completed_ledger_entry_mutation();

CREATE FUNCTION prevent_completed_ledger_transaction_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_ledger_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'COMPLETED' THEN
    RAISE EXCEPTION 'completed ledger transactions are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."status" = 'COMPLETED' THEN
    IF (SELECT COUNT(*) FROM "LedgerEntry" WHERE "transactionId" = NEW."id") < 2 THEN
      RAISE EXCEPTION 'completed ledger transactions require at least two entries';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "LedgerEntry"
      WHERE "transactionId" = NEW."id"
      GROUP BY "asset"
      HAVING SUM(CASE WHEN "direction" = 'DEBIT' THEN "amountMinorUnits" ELSE 0 END)
          <> SUM(CASE WHEN "direction" = 'CREDIT' THEN "amountMinorUnits" ELSE 0 END)
    ) THEN
      RAISE EXCEPTION 'completed ledger transaction is unbalanced';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerTransaction_completed_immutable"
BEFORE UPDATE OR DELETE ON "LedgerTransaction"
FOR EACH ROW EXECUTE FUNCTION prevent_completed_ledger_transaction_mutation();
