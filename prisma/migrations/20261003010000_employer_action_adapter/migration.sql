CREATE TYPE "EmployerActionType" AS ENUM (
  'MARK_REVIEWED',
  'REQUEST_EMPLOYEE_CONTACT',
  'REQUEST_HR_FOLLOW_UP'
);

CREATE TYPE "EmployerActionStatus" AS ENUM (
  'PENDING',
  'COMPLETED',
  'REJECTED',
  'FAILED'
);

CREATE TYPE "EmployerActionProvider" AS ENUM ('MOCK');

CREATE TABLE "EmployerActionAttempt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "evaluationId" UUID NOT NULL,
  "requestedByMembershipId" UUID NOT NULL,
  "action" "EmployerActionType" NOT NULL,
  "status" "EmployerActionStatus" NOT NULL DEFAULT 'PENDING',
  "provider" "EmployerActionProvider" NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "adapterActionId" VARCHAR(64),
  "messageCode" VARCHAR(64) NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployerActionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployerActionAttempt_organizationId_id_key"
ON "EmployerActionAttempt"("organizationId", "id");
CREATE UNIQUE INDEX "EmployerActionAttempt_organizationId_idempotencyKey_key"
ON "EmployerActionAttempt"("organizationId", "idempotencyKey");
CREATE INDEX "EmployerActionAttempt_organizationId_loanId_requestedAt_idx"
ON "EmployerActionAttempt"("organizationId", "loanId", "requestedAt");
CREATE INDEX "EmployerActionAttempt_organizationId_requestedByMembershipId_requestedAt_idx"
ON "EmployerActionAttempt"("organizationId", "requestedByMembershipId", "requestedAt");

ALTER TABLE "EmployerActionAttempt"
ADD CONSTRAINT "EmployerActionAttempt_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployerActionAttempt"
ADD CONSTRAINT "EmployerActionAttempt_organizationId_loanId_fkey"
FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployerActionAttempt"
ADD CONSTRAINT "EmployerActionAttempt_organizationId_evaluationId_fkey"
FOREIGN KEY ("organizationId", "evaluationId") REFERENCES "LoanDecisionEvaluation"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployerActionAttempt"
ADD CONSTRAINT "EmployerActionAttempt_organizationId_requestedByMembershipId_fkey"
FOREIGN KEY ("organizationId", "requestedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
