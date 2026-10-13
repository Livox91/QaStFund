CREATE TYPE "RepaymentPlanStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED');
CREATE TYPE "PayrollDeductionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'UNAVAILABLE', 'PARTIALLY_RECONCILED', 'RECONCILED', 'FAILED');
CREATE TYPE "EmployeeDeductionAuthorizationStatus" AS ENUM ('NOT_RECORDED', 'AUTHORIZED', 'REVOKED');
CREATE TYPE "DelinquencyNotificationStatus" AS ENUM ('CREATED', 'SENT', 'FAILED');
CREATE TYPE "RepaymentArrangementStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

ALTER TYPE "AuditEventType" ADD VALUE 'REPAYMENT_PLAN_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'REPAYMENT_PLAN_REVISED';
ALTER TYPE "AuditEventType" ADD VALUE 'PAYROLL_DEDUCTION_PROPOSED';
ALTER TYPE "AuditEventType" ADD VALUE 'PAYROLL_DEDUCTION_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'PAYROLL_DEDUCTION_RECONCILED';
ALTER TYPE "AuditEventType" ADD VALUE 'DELINQUENCY_NOTIFICATION_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'DELINQUENCY_CASE_REVIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'REPAYMENT_ARRANGEMENT_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE 'REPAYMENT_ARRANGEMENT_REVIEWED';

CREATE TABLE "LoanRepaymentPlan" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RepaymentPlanStatus" NOT NULL DEFAULT 'PROPOSED',
    "termMonths" INTEGER NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "totalRepaymentMinorUnits" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reason" VARCHAR(1000),
    "borrowerConsentedAt" TIMESTAMP(3),
    "approvedByMembershipId" UUID,
    "approvedAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanRepaymentPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoanRepaymentPlan_termMonths_check" CHECK ("termMonths" BETWEEN 1 AND 3),
    CONSTRAINT "LoanRepaymentPlan_installmentCount_check" CHECK ("installmentCount" BETWEEN 1 AND 3),
    CONSTRAINT "LoanRepaymentPlan_total_check" CHECK ("totalRepaymentMinorUnits" > 0),
    CONSTRAINT "LoanRepaymentPlan_approval_check" CHECK (
      ("status" = 'ACTIVE' AND "borrowerConsentedAt" IS NOT NULL AND "approvedByMembershipId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "effectiveAt" IS NOT NULL)
      OR "status" <> 'ACTIVE'
    )
);

CREATE TABLE "LoanInstallment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amountMinorUnits" BIGINT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanInstallment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoanInstallment_sequence_check" CHECK ("sequence" > 0),
    CONSTRAINT "LoanInstallment_amount_check" CHECK ("amountMinorUnits" > 0)
);

CREATE TABLE "RepaymentAllocation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "installmentId" UUID NOT NULL,
    "repaymentId" UUID NOT NULL,
    "amountMinorUnits" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepaymentAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RepaymentAllocation_amount_check" CHECK ("amountMinorUnits" > 0)
);

CREATE TABLE "PayrollDeductionProposal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "installmentId" UUID NOT NULL,
    "employeeMappingId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "payrollPeriodStart" TIMESTAMP(3) NOT NULL,
    "payrollPeriodEnd" TIMESTAMP(3) NOT NULL,
    "requestedAmountMinorUnits" BIGINT NOT NULL,
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
    CONSTRAINT "PayrollDeduction_requested_check" CHECK ("requestedAmountMinorUnits" > 0),
    CONSTRAINT "PayrollDeduction_actual_check" CHECK ("actualDeductedMinorUnits" >= 0 AND "actualDeductedMinorUnits" <= "requestedAmountMinorUnits"),
    CONSTRAINT "PayrollDeduction_authorization_check" CHECK (("authorizationStatus" = 'AUTHORIZED' AND "authorizedAt" IS NOT NULL) OR "authorizationStatus" <> 'AUTHORIZED')
);

CREATE TABLE "DelinquencyNotification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "installmentId" UUID NOT NULL,
    "recipientMembershipId" UUID NOT NULL,
    "thresholdKey" VARCHAR(64) NOT NULL,
    "status" "DelinquencyNotificationStatus" NOT NULL DEFAULT 'CREATED',
    "amountDueMinorUnits" BIGINT NOT NULL,
    "amountPaidMinorUnits" BIGINT NOT NULL,
    "outstandingMinorUnits" BIGINT NOT NULL,
    "daysOverdue" INTEGER NOT NULL,
    "recommendedAction" VARCHAR(64) NOT NULL,
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastFailureCode" VARCHAR(64),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DelinquencyNotification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DelinquencyNotification_amounts_check" CHECK ("amountDueMinorUnits" > 0 AND "amountPaidMinorUnits" >= 0 AND "outstandingMinorUnits" > 0 AND "amountPaidMinorUnits" + "outstandingMinorUnits" = "amountDueMinorUnits"),
    CONSTRAINT "DelinquencyNotification_days_check" CHECK ("daysOverdue" > 0),
    CONSTRAINT "DelinquencyNotification_attempts_check" CHECK ("deliveryAttempts" >= 0)
);

CREATE TABLE "RepaymentArrangement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "originalPlanId" UUID NOT NULL,
    "proposedTermMonths" INTEGER NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "status" "RepaymentArrangementStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByMembershipId" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "reviewedByMembershipId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewRationale" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RepaymentArrangement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RepaymentArrangement_term_check" CHECK ("proposedTermMonths" BETWEEN 1 AND 3),
    CONSTRAINT "RepaymentArrangement_review_check" CHECK (("status" = 'REQUESTED' AND "reviewedAt" IS NULL AND "reviewedByMembershipId" IS NULL) OR ("status" <> 'REQUESTED' AND "reviewedAt" IS NOT NULL AND "reviewedByMembershipId" IS NOT NULL))
);

CREATE UNIQUE INDEX "EmployeeDirectoryMapping_organizationId_id_key" ON "EmployeeDirectoryMapping"("organizationId", "id");
CREATE UNIQUE INDEX "LoanRepaymentPlan_organizationId_id_key" ON "LoanRepaymentPlan"("organizationId", "id");
CREATE UNIQUE INDEX "LoanRepaymentPlan_loanId_version_key" ON "LoanRepaymentPlan"("loanId", "version");
CREATE UNIQUE INDEX "LoanRepaymentPlan_one_active_per_loan_idx" ON "LoanRepaymentPlan"("loanId") WHERE "status" = 'ACTIVE';
CREATE INDEX "LoanRepaymentPlan_organizationId_loanId_status_idx" ON "LoanRepaymentPlan"("organizationId", "loanId", "status");
CREATE UNIQUE INDEX "LoanInstallment_organizationId_id_key" ON "LoanInstallment"("organizationId", "id");
CREATE UNIQUE INDEX "LoanInstallment_planId_sequence_key" ON "LoanInstallment"("planId", "sequence");
CREATE INDEX "LoanInstallment_organizationId_dueAt_idx" ON "LoanInstallment"("organizationId", "dueAt");
CREATE INDEX "LoanInstallment_organizationId_loanId_dueAt_idx" ON "LoanInstallment"("organizationId", "loanId", "dueAt");
CREATE UNIQUE INDEX "RepaymentAllocation_organizationId_id_key" ON "RepaymentAllocation"("organizationId", "id");
CREATE UNIQUE INDEX "RepaymentAllocation_installmentId_repaymentId_key" ON "RepaymentAllocation"("installmentId", "repaymentId");
CREATE INDEX "RepaymentAllocation_organizationId_installmentId_idx" ON "RepaymentAllocation"("organizationId", "installmentId");
CREATE INDEX "RepaymentAllocation_organizationId_repaymentId_idx" ON "RepaymentAllocation"("organizationId", "repaymentId");
CREATE UNIQUE INDEX "PayrollDeductionProposal_repaymentId_key" ON "PayrollDeductionProposal"("repaymentId");
CREATE UNIQUE INDEX "PayrollDeductionProposal_organizationId_id_key" ON "PayrollDeductionProposal"("organizationId", "id");
CREATE UNIQUE INDEX "PayrollDeductionProposal_organizationId_idempotencyKey_key" ON "PayrollDeductionProposal"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "PayrollDeductionProposal_organizationId_repaymentId_key" ON "PayrollDeductionProposal"("organizationId", "repaymentId");
CREATE UNIQUE INDEX "PayrollDeductionProposal_installmentId_period_key" ON "PayrollDeductionProposal"("installmentId", "payrollPeriodStart", "payrollPeriodEnd");
CREATE INDEX "PayrollDeductionProposal_organizationId_status_period_idx" ON "PayrollDeductionProposal"("organizationId", "status", "payrollPeriodStart");
CREATE INDEX "PayrollDeductionProposal_organizationId_employee_period_idx" ON "PayrollDeductionProposal"("organizationId", "employeeMappingId", "payrollPeriodStart");
CREATE UNIQUE INDEX "DelinquencyNotification_organizationId_id_key" ON "DelinquencyNotification"("organizationId", "id");
CREATE UNIQUE INDEX "DelinquencyNotification_installmentId_thresholdKey_key" ON "DelinquencyNotification"("installmentId", "thresholdKey");
CREATE INDEX "DelinquencyNotification_organizationId_status_createdAt_idx" ON "DelinquencyNotification"("organizationId", "status", "createdAt");
CREATE INDEX "DelinquencyNotification_organizationId_loanId_createdAt_idx" ON "DelinquencyNotification"("organizationId", "loanId", "createdAt");
CREATE UNIQUE INDEX "RepaymentArrangement_organizationId_id_key" ON "RepaymentArrangement"("organizationId", "id");
CREATE INDEX "RepaymentArrangement_organizationId_loanId_status_idx" ON "RepaymentArrangement"("organizationId", "loanId", "status");

ALTER TABLE "LoanRepaymentPlan" ADD CONSTRAINT "LoanRepaymentPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanRepaymentPlan" ADD CONSTRAINT "LoanRepaymentPlan_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanRepaymentPlan" ADD CONSTRAINT "LoanRepaymentPlan_organizationId_approvedByMembershipId_fkey" FOREIGN KEY ("organizationId", "approvedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanInstallment" ADD CONSTRAINT "LoanInstallment_organizationId_planId_fkey" FOREIGN KEY ("organizationId", "planId") REFERENCES "LoanRepaymentPlan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepaymentAllocation" ADD CONSTRAINT "RepaymentAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepaymentAllocation" ADD CONSTRAINT "RepaymentAllocation_organizationId_installmentId_fkey" FOREIGN KEY ("organizationId", "installmentId") REFERENCES "LoanInstallment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepaymentAllocation" ADD CONSTRAINT "RepaymentAllocation_organizationId_repaymentId_fkey" FOREIGN KEY ("organizationId", "repaymentId") REFERENCES "LoanRepayment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_installmentId_fkey" FOREIGN KEY ("organizationId", "installmentId") REFERENCES "LoanInstallment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_employeeMappingId_fkey" FOREIGN KEY ("organizationId", "employeeMappingId") REFERENCES "EmployeeDirectoryMapping"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_reviewedByMembershipId_fkey" FOREIGN KEY ("organizationId", "reviewedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollDeductionProposal" ADD CONSTRAINT "PayrollDeductionProposal_organizationId_repaymentId_fkey" FOREIGN KEY ("organizationId", "repaymentId") REFERENCES "LoanRepayment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DelinquencyNotification" ADD CONSTRAINT "DelinquencyNotification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DelinquencyNotification" ADD CONSTRAINT "DelinquencyNotification_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DelinquencyNotification" ADD CONSTRAINT "DelinquencyNotification_organizationId_installmentId_fkey" FOREIGN KEY ("organizationId", "installmentId") REFERENCES "LoanInstallment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DelinquencyNotification" ADD CONSTRAINT "DelinquencyNotification_organizationId_recipientMembershipId_fkey" FOREIGN KEY ("organizationId", "recipientMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepaymentArrangement" ADD CONSTRAINT "RepaymentArrangement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepaymentArrangement" ADD CONSTRAINT "RepaymentArrangement_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepaymentArrangement" ADD CONSTRAINT "RepaymentArrangement_organizationId_originalPlanId_fkey" FOREIGN KEY ("organizationId", "originalPlanId") REFERENCES "LoanRepaymentPlan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepaymentArrangement" ADD CONSTRAINT "RepaymentArrangement_organizationId_requestedByMembershipId_fkey" FOREIGN KEY ("organizationId", "requestedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepaymentArrangement" ADD CONSTRAINT "RepaymentArrangement_organizationId_reviewedByMembershipId_fkey" FOREIGN KEY ("organizationId", "reviewedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
