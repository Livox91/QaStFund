ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'LENDING_POLICY_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_BORROWING_SUSPENDED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_BORROWING_ENABLED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_LENDING_SUSPENDED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_LENDING_ENABLED';

ALTER TABLE "OrganizationMembership"
  ADD COLUMN "canBorrow" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canLend" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Loan"
  ADD COLUMN "policyVersion" INTEGER,
  ADD COLUMN "policySnapshot" JSONB;

ALTER TABLE "AuditEvent"
  ALTER COLUMN "loanId" DROP NOT NULL,
  ADD COLUMN "targetMembershipId" UUID,
  ADD COLUMN "metadata" JSONB;

CREATE INDEX "AuditEvent_organizationId_targetMembershipId_occurredAt_idx"
  ON "AuditEvent"("organizationId", "targetMembershipId", "occurredAt");
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_targetMembershipId_fkey"
  FOREIGN KEY ("organizationId", "targetMembershipId")
  REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OrganizationLendingPolicy" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "lendingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "borrowingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "maxLoanAmountMinorUnits" BIGINT NOT NULL DEFAULT 10000,
  "maxOutstandingDebtMinorUnits" BIGINT NOT NULL DEFAULT 25000,
  "maxActiveLoans" INTEGER NOT NULL DEFAULT 3,
  "minInterestRateBasisPoints" INTEGER NOT NULL DEFAULT 0,
  "maxInterestRateBasisPoints" INTEGER NOT NULL DEFAULT 500,
  "minTermDays" INTEGER NOT NULL DEFAULT 7,
  "maxTermDays" INTEGER NOT NULL DEFAULT 60,
  "policyVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationLendingPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationLendingPolicy_values_check" CHECK (
    "maxLoanAmountMinorUnits" > 0
    AND "maxOutstandingDebtMinorUnits" >= "maxLoanAmountMinorUnits"
    AND "maxActiveLoans" > 0
    AND "minInterestRateBasisPoints" >= 0
    AND "maxInterestRateBasisPoints" >= "minInterestRateBasisPoints"
    AND "maxInterestRateBasisPoints" <= 10000
    AND "minTermDays" > 0
    AND "maxTermDays" >= "minTermDays"
    AND "maxTermDays" <= 365
  )
);
CREATE UNIQUE INDEX "OrganizationLendingPolicy_organizationId_key"
  ON "OrganizationLendingPolicy"("organizationId");
ALTER TABLE "OrganizationLendingPolicy" ADD CONSTRAINT "OrganizationLendingPolicy_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "OrganizationLendingPolicy" (
  "id", "organizationId", "updatedAt"
)
SELECT gen_random_uuid(), "id", CURRENT_TIMESTAMP FROM "Organization";

CREATE FUNCTION provision_default_lending_policy() RETURNS trigger AS $$
BEGIN
  INSERT INTO "OrganizationLendingPolicy" ("id", "organizationId", "updatedAt")
  VALUES (gen_random_uuid(), NEW."id", CURRENT_TIMESTAMP)
  ON CONFLICT ("organizationId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Organization_provision_default_lending_policy"
AFTER INSERT ON "Organization"
FOR EACH ROW EXECUTE FUNCTION provision_default_lending_policy();
