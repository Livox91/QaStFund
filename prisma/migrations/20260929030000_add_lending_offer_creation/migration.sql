-- AddColumns
ALTER TABLE "LendingOffer"
ADD COLUMN "minimumLoanAmountMinorUnits" BIGINT,
ADD COLUMN "maximumLoanAmountMinorUnits" BIGINT,
ADD COLUMN "durationDays" INTEGER,
ADD COLUMN "feeRateBasisPoints" INTEGER,
ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Backfill existing demo/reporting offers before making terms required.
UPDATE "LendingOffer"
SET
  "minimumLoanAmountMinorUnits" = LEAST("amountMinorUnits", 10000),
  "maximumLoanAmountMinorUnits" = "amountMinorUnits",
  "durationDays" = 30,
  "feeRateBasisPoints" = 500,
  "expiresAt" = "createdAt" + INTERVAL '90 days';

ALTER TABLE "LendingOffer"
ALTER COLUMN "minimumLoanAmountMinorUnits" SET NOT NULL,
ALTER COLUMN "maximumLoanAmountMinorUnits" SET NOT NULL,
ALTER COLUMN "durationDays" SET NOT NULL,
ALTER COLUMN "feeRateBasisPoints" SET NOT NULL,
ALTER COLUMN "expiresAt" SET NOT NULL,
DROP CONSTRAINT "LendingOffer_amount_check",
ADD CONSTRAINT "LendingOffer_amount_check"
  CHECK (
    "amountMinorUnits" > 0
    AND "availableAmountMinorUnits" >= 0
    AND "availableAmountMinorUnits" <= "amountMinorUnits"
  ),
ADD CONSTRAINT "LendingOffer_terms_check"
  CHECK (
    "minimumLoanAmountMinorUnits" > 0
    AND "maximumLoanAmountMinorUnits" >= "minimumLoanAmountMinorUnits"
    AND "maximumLoanAmountMinorUnits" <= "amountMinorUnits"
    AND "durationDays" BETWEEN 1 AND 365
    AND "feeRateBasisPoints" BETWEEN 0 AND 10000
    AND "expiresAt" > "createdAt"
  );

-- CreateTable
CREATE TABLE "EmployeeBalance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "amountMinorUnits" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeBalance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmployeeBalance_amount_check" CHECK ("amountMinorUnits" >= 0),
    CONSTRAINT "EmployeeBalance_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

-- CreateIndex
CREATE INDEX "LendingOffer_organizationId_status_expiresAt_idx" ON "LendingOffer"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeBalance_organizationId_membershipId_key" ON "EmployeeBalance"("organizationId", "membershipId");

-- CreateIndex
CREATE INDEX "EmployeeBalance_organizationId_idx" ON "EmployeeBalance"("organizationId");

-- AddForeignKey
ALTER TABLE "EmployeeBalance" ADD CONSTRAINT "EmployeeBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBalance" ADD CONSTRAINT "EmployeeBalance_organizationId_membershipId_fkey" FOREIGN KEY ("organizationId", "membershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
