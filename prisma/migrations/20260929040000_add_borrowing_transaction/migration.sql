CREATE TYPE "LedgerAccountType" AS ENUM ('MOCK_CASH');
CREATE TYPE "LedgerTransactionType" AS ENUM ('LOAN_DISBURSEMENT');
CREATE TYPE "LedgerEntryDirection" AS ENUM ('DEBIT', 'CREDIT');

ALTER TABLE "Loan"
  ADD COLUMN "borrowRequestId" UUID,
  ADD COLUMN "durationDays" INTEGER,
  ADD COLUMN "feeRateBasisPoints" INTEGER,
  ADD COLUMN "lendingOfferId" UUID;

-- Existing demo loans predate terms snapshots. Derive their original term
-- and effective fee rate once so all loans have immutable agreed terms.
UPDATE "Loan"
SET
  "durationDays" = GREATEST(1, ("repaymentDueAt"::date - "startedAt"::date)),
  "feeRateBasisPoints" = CASE
    WHEN "principalAmountMinorUnits" = 0 THEN 0
    ELSE (("feeAmountMinorUnits" * 10000) / "principalAmountMinorUnits")::integer
  END;

ALTER TABLE "Loan"
  ALTER COLUMN "durationDays" SET NOT NULL,
  ALTER COLUMN "feeRateBasisPoints" SET NOT NULL,
  ADD CONSTRAINT "Loan_durationDays_check" CHECK ("durationDays" BETWEEN 1 AND 365),
  ADD CONSTRAINT "Loan_feeRateBasisPoints_check" CHECK ("feeRateBasisPoints" BETWEEN 0 AND 10000);

CREATE TABLE "LedgerAccount" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "membershipId" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "type" "LedgerAccountType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerTransaction" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "type" "LedgerTransactionType" NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerEntry" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "transactionId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "direction" "LedgerEntryDirection" NOT NULL,
  "amountMinorUnits" BIGINT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_positive_amount_check" CHECK ("amountMinorUnits" > 0),
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LedgerAccount_organizationId_membershipId_idx" ON "LedgerAccount"("organizationId", "membershipId");
CREATE UNIQUE INDEX "LedgerAccount_organizationId_membershipId_currency_type_key" ON "LedgerAccount"("organizationId", "membershipId", "currency", "type");
CREATE UNIQUE INDEX "LedgerAccount_organizationId_id_key" ON "LedgerAccount"("organizationId", "id");
CREATE UNIQUE INDEX "LedgerTransaction_loanId_key" ON "LedgerTransaction"("loanId");
CREATE INDEX "LedgerTransaction_organizationId_createdAt_idx" ON "LedgerTransaction"("organizationId", "createdAt");
CREATE UNIQUE INDEX "LedgerTransaction_organizationId_id_key" ON "LedgerTransaction"("organizationId", "id");
CREATE UNIQUE INDEX "LedgerTransaction_organizationId_loanId_key" ON "LedgerTransaction"("organizationId", "loanId");
CREATE INDEX "LedgerEntry_organizationId_transactionId_idx" ON "LedgerEntry"("organizationId", "transactionId");
CREATE INDEX "LedgerEntry_organizationId_accountId_idx" ON "LedgerEntry"("organizationId", "accountId");
CREATE UNIQUE INDEX "LendingOffer_organizationId_id_key" ON "LendingOffer"("organizationId", "id");
CREATE UNIQUE INDEX "Loan_borrowRequestId_key" ON "Loan"("borrowRequestId");

ALTER TABLE "Loan" ADD CONSTRAINT "Loan_organizationId_lendingOfferId_fkey" FOREIGN KEY ("organizationId", "lendingOfferId") REFERENCES "LendingOffer"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_organizationId_membershipId_fkey" FOREIGN KEY ("organizationId", "membershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_organizationId_transactionId_fkey" FOREIGN KEY ("organizationId", "transactionId") REFERENCES "LedgerTransaction"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_organizationId_accountId_fkey" FOREIGN KEY ("organizationId", "accountId") REFERENCES "LedgerAccount"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
