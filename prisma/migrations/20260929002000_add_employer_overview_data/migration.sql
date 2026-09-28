-- CreateEnum
CREATE TYPE "LendingOfferStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'REPAID', 'OVERDUE', 'DEFAULTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Organization"
ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
ADD CONSTRAINT "Organization_currency_format_check"
CHECK ("currency" ~ '^[A-Z]{3}$');

-- CreateTable
CREATE TABLE "LendingOffer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "lenderMembershipId" UUID NOT NULL,
    "amountMinorUnits" BIGINT NOT NULL,
    "availableAmountMinorUnits" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "LendingOfferStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LendingOffer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LendingOffer_amount_check"
      CHECK ("amountMinorUnits" >= 0 AND "availableAmountMinorUnits" >= 0 AND "availableAmountMinorUnits" <= "amountMinorUnits"),
    CONSTRAINT "LendingOffer_currency_format_check"
      CHECK ("currency" ~ '^[A-Z]{3}$')
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "lenderMembershipId" UUID NOT NULL,
    "borrowerMembershipId" UUID NOT NULL,
    "principalAmountMinorUnits" BIGINT NOT NULL,
    "outstandingPrincipalMinorUnits" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "LoanStatus" NOT NULL,
    "repaymentDueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Loan_principal_check"
      CHECK ("principalAmountMinorUnits" > 0 AND "outstandingPrincipalMinorUnits" >= 0 AND "outstandingPrincipalMinorUnits" <= "principalAmountMinorUnits"),
    CONSTRAINT "Loan_distinct_parties_check"
      CHECK ("lenderMembershipId" <> "borrowerMembershipId"),
    CONSTRAINT "Loan_currency_format_check"
      CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "Loan_repaid_balance_check"
      CHECK ("status" <> 'REPAID' OR "outstandingPrincipalMinorUnits" = 0)
);

-- CreateIndex
CREATE INDEX "LendingOffer_organizationId_status_idx" ON "LendingOffer"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LendingOffer_organizationId_lenderMembershipId_idx" ON "LendingOffer"("organizationId", "lenderMembershipId");

-- CreateIndex
CREATE INDEX "Loan_organizationId_status_idx" ON "Loan"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Loan_organizationId_repaymentDueAt_idx" ON "Loan"("organizationId", "repaymentDueAt");

-- CreateIndex
CREATE INDEX "Loan_organizationId_lenderMembershipId_idx" ON "Loan"("organizationId", "lenderMembershipId");

-- CreateIndex
CREATE INDEX "Loan_organizationId_borrowerMembershipId_idx" ON "Loan"("organizationId", "borrowerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_id_key" ON "OrganizationMembership"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "LendingOffer" ADD CONSTRAINT "LendingOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LendingOffer" ADD CONSTRAINT "LendingOffer_organizationId_lenderMembershipId_fkey" FOREIGN KEY ("organizationId", "lenderMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_organizationId_lenderMembershipId_fkey" FOREIGN KEY ("organizationId", "lenderMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_organizationId_borrowerMembershipId_fkey" FOREIGN KEY ("organizationId", "borrowerMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
