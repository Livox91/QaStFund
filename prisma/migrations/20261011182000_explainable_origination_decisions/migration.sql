ALTER TYPE "AuditEventType" ADD VALUE 'LOAN_ORIGINATION_DECISION_RECORDED';
ALTER TYPE "AuditEventType" ADD VALUE 'LOAN_ORIGINATION_DECISION_OVERRIDDEN';

CREATE TYPE "LoanOriginationDecisionStatus" AS ENUM (
  'ELIGIBLE_FOR_CONSIDERATION',
  'REVIEW_REQUIRED',
  'NOT_ELIGIBLE'
);

CREATE TYPE "LoanOriginationOverrideOutcome" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "LoanOriginationDecision" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "borrowerMembershipId" UUID NOT NULL,
  "modelVersion" VARCHAR(64) NOT NULL,
  "status" "LoanOriginationDecisionStatus" NOT NULL,
  "score" INTEGER,
  "reasonCodes" TEXT[],
  "inputSnapshot" JSONB NOT NULL,
  "affordabilitySnapshot" JSONB NOT NULL,
  "evaluatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoanOriginationDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoanOriginationOverride" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "decisionId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "reviewedByMembershipId" UUID NOT NULL,
  "outcome" "LoanOriginationOverrideOutcome" NOT NULL,
  "rationale" VARCHAR(1000) NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoanOriginationOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoanOriginationDecision_loanId_modelVersion_key"
  ON "LoanOriginationDecision"("loanId", "modelVersion");
CREATE UNIQUE INDEX "LoanOriginationDecision_organizationId_id_key"
  ON "LoanOriginationDecision"("organizationId", "id");
CREATE INDEX "LoanOriginationDecision_organizationId_status_evaluatedAt_idx"
  ON "LoanOriginationDecision"("organizationId", "status", "evaluatedAt");
CREATE INDEX "LoanOriginationDecision_organizationId_borrowerMembershipId_evaluatedAt_idx"
  ON "LoanOriginationDecision"("organizationId", "borrowerMembershipId", "evaluatedAt");

CREATE UNIQUE INDEX "LoanOriginationOverride_decisionId_key"
  ON "LoanOriginationOverride"("decisionId");
CREATE UNIQUE INDEX "LoanOriginationOverride_organizationId_id_key"
  ON "LoanOriginationOverride"("organizationId", "id");
CREATE UNIQUE INDEX "LoanOriginationOverride_organizationId_decisionId_key"
  ON "LoanOriginationOverride"("organizationId", "decisionId");
CREATE INDEX "LoanOriginationOverride_organizationId_loanId_reviewedAt_idx"
  ON "LoanOriginationOverride"("organizationId", "loanId", "reviewedAt");

-- One unresolved application per borrower prevents concurrent requests from
-- bypassing exposure checks. Completed/cancelled loans do not block a retry.
CREATE UNIQUE INDEX "Loan_one_requested_per_borrower_idx"
  ON "Loan"("organizationId", "borrowerMembershipId")
  WHERE "status" = 'REQUESTED';

ALTER TABLE "LoanOriginationDecision"
  ADD CONSTRAINT "LoanOriginationDecision_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanOriginationDecision"
  ADD CONSTRAINT "LoanOriginationDecision_organizationId_loanId_fkey"
  FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanOriginationDecision"
  ADD CONSTRAINT "LoanOriginationDecision_organizationId_borrowerMembershipId_fkey"
  FOREIGN KEY ("organizationId", "borrowerMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanOriginationOverride"
  ADD CONSTRAINT "LoanOriginationOverride_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanOriginationOverride"
  ADD CONSTRAINT "LoanOriginationOverride_organizationId_decisionId_fkey"
  FOREIGN KEY ("organizationId", "decisionId") REFERENCES "LoanOriginationDecision"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanOriginationOverride"
  ADD CONSTRAINT "LoanOriginationOverride_organizationId_reviewedByMembershipId_fkey"
  FOREIGN KEY ("organizationId", "reviewedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
