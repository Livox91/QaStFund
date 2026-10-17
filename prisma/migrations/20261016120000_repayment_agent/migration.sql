-- CreateEnum
CREATE TYPE "RepaymentAgentMandateStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RepaymentAgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'WAITING', 'AWAITING_APPROVAL', 'ESCALATED', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "RepaymentAgentTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'APPROVAL_FOLLOW_UP');

-- CreateEnum
CREATE TYPE "RepaymentAgentPlannerKind" AS ENUM ('MODEL', 'RULES');

-- CreateEnum
CREATE TYPE "RepaymentAgentActionStatus" AS ENUM ('VALIDATED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'AWAITING_APPROVAL', 'APPROVED', 'EXPIRED', 'REJECTED');

-- CreateTable
CREATE TABLE "RepaymentAgentMandate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "borrowerMembershipId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "walletAddress" VARCHAR(42) NOT NULL,
    "contractAddress" VARCHAR(42) NOT NULL,
    "agentAddress" VARCHAR(42) NOT NULL,
    "chainNonce" VARCHAR(78),
    "maxPerRepaymentBaseUnits" BIGINT NOT NULL,
    "maxPerPeriodBaseUnits" BIGINT NOT NULL,
    "minimumReserveBaseUnits" BIGINT NOT NULL,
    "periodSeconds" INTEGER NOT NULL,
    "earliestBeforeDueSeconds" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "allowanceBaseUnits" BIGINT NOT NULL,
    "status" "RepaymentAgentMandateStatus" NOT NULL DEFAULT 'PENDING',
    "transactionHash" VARCHAR(66),
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepaymentAgentMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepaymentAgentRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "borrowerMembershipId" UUID NOT NULL,
    "trigger" "RepaymentAgentTrigger" NOT NULL,
    "status" "RepaymentAgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "plannerKind" "RepaymentAgentPlannerKind" NOT NULL,
    "plannerModel" VARCHAR(64),
    "promptVersion" VARCHAR(64) NOT NULL,
    "policyVersion" VARCHAR(64) NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "decision" JSONB,
    "outcomeCode" VARCHAR(64),
    "outcomeSummary" VARCHAR(1000),
    "requiresHumanApproval" BOOLEAN NOT NULL DEFAULT false,
    "parentRunId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepaymentAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepaymentAgentStep" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "phase" VARCHAR(16) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepaymentAgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepaymentAgentAction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "borrowerMembershipId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "amountBaseUnits" BIGINT,
    "status" "RepaymentAgentActionStatus" NOT NULL,
    "repaymentRequestId" UUID NOT NULL,
    "chainRepaymentId" VARCHAR(66) NOT NULL,
    "mandateNonce" VARCHAR(78),
    "decision" JSONB NOT NULL,
    "validation" JSONB NOT NULL,
    "transactionHash" VARCHAR(66),
    "verification" JSONB,
    "failureCode" VARCHAR(64),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepaymentAgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepaymentAgentMandate_requestId_key" ON "RepaymentAgentMandate"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "RepaymentAgentMandate_transactionHash_key" ON "RepaymentAgentMandate"("transactionHash");

-- CreateIndex
CREATE INDEX "RepaymentAgentMandate_organizationId_borrowerMembershipId_s_idx" ON "RepaymentAgentMandate"("organizationId", "borrowerMembershipId", "status");

-- CreateIndex
CREATE INDEX "RepaymentAgentMandate_status_idx" ON "RepaymentAgentMandate"("status");

-- CreateIndex
CREATE INDEX "RepaymentAgentRun_organizationId_borrowerMembershipId_start_idx" ON "RepaymentAgentRun"("organizationId", "borrowerMembershipId", "startedAt");

-- CreateIndex
CREATE INDEX "RepaymentAgentRun_status_startedAt_idx" ON "RepaymentAgentRun"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepaymentAgentRun_organizationId_id_key" ON "RepaymentAgentRun"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RepaymentAgentStep_runId_sequence_key" ON "RepaymentAgentStep"("runId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "RepaymentAgentAction_repaymentRequestId_key" ON "RepaymentAgentAction"("repaymentRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "RepaymentAgentAction_chainRepaymentId_key" ON "RepaymentAgentAction"("chainRepaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "RepaymentAgentAction_transactionHash_key" ON "RepaymentAgentAction"("transactionHash");

-- CreateIndex
CREATE INDEX "RepaymentAgentAction_organizationId_borrowerMembershipId_st_idx" ON "RepaymentAgentAction"("organizationId", "borrowerMembershipId", "status");

-- CreateIndex
CREATE INDEX "RepaymentAgentAction_status_updatedAt_idx" ON "RepaymentAgentAction"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "RepaymentAgentMandate" ADD CONSTRAINT "RepaymentAgentMandate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentAgentMandate" ADD CONSTRAINT "RepaymentAgentMandate_organizationId_borrowerMembershipId_fkey" FOREIGN KEY ("organizationId", "borrowerMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentAgentRun" ADD CONSTRAINT "RepaymentAgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentAgentRun" ADD CONSTRAINT "RepaymentAgentRun_organizationId_borrowerMembershipId_fkey" FOREIGN KEY ("organizationId", "borrowerMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentAgentStep" ADD CONSTRAINT "RepaymentAgentStep_organizationId_runId_fkey" FOREIGN KEY ("organizationId", "runId") REFERENCES "RepaymentAgentRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentAgentAction" ADD CONSTRAINT "RepaymentAgentAction_organizationId_runId_fkey" FOREIGN KEY ("organizationId", "runId") REFERENCES "RepaymentAgentRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepaymentAgentAction" ADD CONSTRAINT "RepaymentAgentAction_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one active mandate per borrower.
CREATE UNIQUE INDEX "RepaymentAgentMandate_one_active_per_borrower"
    ON "RepaymentAgentMandate"("borrowerMembershipId")
    WHERE "status" = 'ACTIVE';

-- At most one in-flight agent repayment per borrower: the agent monitors a
-- submitted operation and never submits a second one beside it.
CREATE UNIQUE INDEX "RepaymentAgentAction_one_in_flight_per_borrower"
    ON "RepaymentAgentAction"("borrowerMembershipId")
    WHERE "status" = 'SUBMITTED';

ALTER TABLE "RepaymentAgentMandate"
  ADD CONSTRAINT "RepaymentAgentMandate_limits_check" CHECK (
    "maxPerRepaymentBaseUnits" > 0
    AND "maxPerPeriodBaseUnits" >= "maxPerRepaymentBaseUnits"
    AND "minimumReserveBaseUnits" >= 0
    AND "allowanceBaseUnits" >= 0
    AND "periodSeconds" > 0
    AND "earliestBeforeDueSeconds" >= 0
  );

ALTER TABLE "RepaymentAgentAction"
  ADD CONSTRAINT "RepaymentAgentAction_amount_check" CHECK (
    "amountBaseUnits" IS NULL OR "amountBaseUnits" > 0
  );

-- Run lease: one active agent run per borrower. Stale leases are expired by
-- the application before a new run starts.
CREATE UNIQUE INDEX "RepaymentAgentRun_one_running_per_borrower"
    ON "RepaymentAgentRun"("borrowerMembershipId")
    WHERE "status" = 'RUNNING';
