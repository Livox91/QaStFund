CREATE TYPE "PayrollDeductionStatus" AS ENUM ('PROPOSED', 'AWAITING_APPROVAL', 'APPROVED', 'SUBMITTED', 'PARTIALLY_DEDUCTED', 'RECONCILED', 'REJECTED', 'FAILED', 'NOT_AVAILABLE');
CREATE TYPE "EmployeeDeductionAuthorizationStatus" AS ENUM ('NOT_RECORDED', 'AUTHORIZED', 'REVOKED');
CREATE TYPE "DelinquencyCaseStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "PayrollDeductionProposal" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "installmentId" UUID NOT NULL,
  "employeeMappingId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "payrollPeriodStart" TIMESTAMP(3) NOT NULL,
  "payrollPeriodEnd" TIMESTAMP(3) NOT NULL,
  "scheduledAmountMinorUnits" BIGINT NOT NULL,
  "outstandingAmountMinorUnits" BIGINT NOT NULL,
  "proposedAmountMinorUnits" BIGINT NOT NULL,
  "actualDeductedMinorUnits" BIGINT NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL,
  "authorizationStatus" "EmployeeDeductionAuthorizationStatus" NOT NULL DEFAULT 'NOT_RECORDED',
  "authorizedAt" TIMESTAMP(3),
  "status" "PayrollDeductionStatus" NOT NULL DEFAULT 'PROPOSED',
  "reviewedByMembershipId" UUID,
  "reviewedAt" TIMESTAMP(3),
  "reviewRationale" VARCHAR(1000),
  "erpNextDocumentType" VARCHAR(64),
  "erpNextDocumentReference" VARCHAR(140),
  "lastSyncErrorCode" VARCHAR(64),
  "repaymentId" UUID,
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollDeductionProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollDeduction_period_check" CHECK ("payrollPeriodEnd" >= "payrollPeriodStart"),
  CONSTRAINT "PayrollDeduction_amounts_check" CHECK (
    "scheduledAmountMinorUnits" > 0 AND
    "outstandingAmountMinorUnits" > 0 AND
    "proposedAmountMinorUnits" > 0 AND
    "proposedAmountMinorUnits" <= "outstandingAmountMinorUnits" AND
    "actualDeductedMinorUnits" >= 0 AND
    "actualDeductedMinorUnits" <= "proposedAmountMinorUnits"
  ),
  CONSTRAINT "PayrollDeduction_authorization_check" CHECK (
    ("authorizationStatus" = 'AUTHORIZED' AND "authorizedAt" IS NOT NULL) OR
    ("authorizationStatus" <> 'AUTHORIZED' AND "authorizedAt" IS NULL)
  ),
  CONSTRAINT "PayrollDeduction_review_check" CHECK (
    ("status" IN ('APPROVED', 'SUBMITTED', 'PARTIALLY_DEDUCTED', 'RECONCILED', 'REJECTED', 'FAILED', 'NOT_AVAILABLE') AND "reviewedByMembershipId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
    OR "status" IN ('PROPOSED', 'AWAITING_APPROVAL')
  )
);

CREATE TABLE "DelinquencyCase" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "installmentId" UUID NOT NULL,
  "status" "DelinquencyCaseStatus" NOT NULL DEFAULT 'OPEN',
  "amountDueMinorUnits" BIGINT NOT NULL,
  "amountPaidMinorUnits" BIGINT NOT NULL,
  "outstandingMinorUnits" BIGINT NOT NULL,
  "daysOverdue" INTEGER NOT NULL,
  "state" VARCHAR(32) NOT NULL,
  "payrollStatus" VARCHAR(32),
  "recommendedAction" VARCHAR(64) NOT NULL,
  "lastEvaluatedAt" TIMESTAMP(3) NOT NULL,
  "reviewedByMembershipId" UUID,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" VARCHAR(1000),
  "employeeContactedAt" TIMESTAMP(3),
  "contactNote" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DelinquencyCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DelinquencyCase_amounts_check" CHECK (
    "amountDueMinorUnits" > 0 AND "amountPaidMinorUnits" >= 0 AND
    "outstandingMinorUnits" >= 0 AND
    "amountPaidMinorUnits" + "outstandingMinorUnits" = "amountDueMinorUnits"
  ),
  CONSTRAINT "DelinquencyCase_days_check" CHECK ("daysOverdue" >= 0)
);

CREATE TABLE "DelinquencyNotification" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "recipientMembershipId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "thresholdKey" VARCHAR(64) NOT NULL,
  "deliveryStatus" "EmailDeliveryStatus" NOT NULL DEFAULT 'CREATED',
  "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastFailureCode" VARCHAR(64),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DelinquencyNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DelinquencyNotification_attempts_check" CHECK ("deliveryAttempts" >= 0)
);

CREATE UNIQUE INDEX "PayrollDeductionProposal_organizationId_id_key" ON "PayrollDeductionProposal"("organizationId", "id");
CREATE UNIQUE INDEX "PayrollDeductionProposal_organizationId_idempotencyKey_key" ON "PayrollDeductionProposal"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "PayrollDeductionProposal_installmentId_period_key" ON "PayrollDeductionProposal"("installmentId", "payrollPeriodStart", "payrollPeriodEnd");
CREATE UNIQUE INDEX "PayrollDeductionProposal_repaymentId_key" ON "PayrollDeductionProposal"("repaymentId");
CREATE INDEX "PayrollDeductionProposal_organizationId_status_period_idx" ON "PayrollDeductionProposal"("organizationId", "status", "payrollPeriodStart");
CREATE INDEX "PayrollDeductionProposal_organizationId_employee_period_idx" ON "PayrollDeductionProposal"("organizationId", "employeeMappingId", "payrollPeriodStart");

CREATE UNIQUE INDEX "DelinquencyCase_organizationId_id_key" ON "DelinquencyCase"("organizationId", "id");
CREATE UNIQUE INDEX "DelinquencyCase_installmentId_key" ON "DelinquencyCase"("installmentId");
CREATE INDEX "DelinquencyCase_organizationId_status_daysOverdue_idx" ON "DelinquencyCase"("organizationId", "status", "daysOverdue");
CREATE INDEX "DelinquencyCase_organizationId_loanId_idx" ON "DelinquencyCase"("organizationId", "loanId");

CREATE UNIQUE INDEX "DelinquencyNotification_organizationId_id_key" ON "DelinquencyNotification"("organizationId", "id");
CREATE UNIQUE INDEX "DelinquencyNotification_idempotencyKey_key" ON "DelinquencyNotification"("idempotencyKey");
CREATE UNIQUE INDEX "DelinquencyNotification_caseId_thresholdKey_key" ON "DelinquencyNotification"("caseId", "thresholdKey");
CREATE INDEX "DelinquencyNotification_organizationId_deliveryStatus_createdAt_idx" ON "DelinquencyNotification"("organizationId", "deliveryStatus", "createdAt");

ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_installmentId_fkey" FOREIGN KEY ("organizationId", "installmentId") REFERENCES "LoanInstallment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_employeeMappingId_fkey" FOREIGN KEY ("organizationId", "employeeMappingId") REFERENCES "EmployeeDirectoryMapping"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_reviewedByMembershipId_fkey" FOREIGN KEY ("organizationId", "reviewedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_repaymentId_fkey" FOREIGN KEY ("organizationId", "repaymentId") REFERENCES "LoanRepayment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DelinquencyCase" ADD CONSTRAINT "DelinquencyCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DelinquencyCase" ADD CONSTRAINT "DelinquencyCase_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DelinquencyCase" ADD CONSTRAINT "DelinquencyCase_organizationId_installmentId_fkey" FOREIGN KEY ("organizationId", "installmentId") REFERENCES "LoanInstallment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DelinquencyCase" ADD CONSTRAINT "DelinquencyCase_organizationId_reviewedByMembershipId_fkey" FOREIGN KEY ("organizationId", "reviewedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DelinquencyNotification" ADD CONSTRAINT "DelinquencyNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DelinquencyNotification" ADD CONSTRAINT "DelinquencyNotification_organizationId_caseId_fkey" FOREIGN KEY ("organizationId", "caseId") REFERENCES "DelinquencyCase"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DelinquencyNotification" ADD CONSTRAINT "DelinquencyNotification_organizationId_recipientMembershipId_fkey" FOREIGN KEY ("organizationId", "recipientMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
