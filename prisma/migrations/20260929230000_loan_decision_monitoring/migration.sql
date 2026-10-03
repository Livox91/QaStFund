CREATE TYPE "LoanDecisionClassification" AS ENUM (
  'HEALTHY',
  'DUE_SOON',
  'OVERDUE',
  'DEFAULT_CANDIDATE'
);

CREATE TYPE "LoanDecisionAction" AS ENUM (
  'NONE',
  'REMIND',
  'FLAG_FOR_REVIEW',
  'EMPLOYER_REVIEW'
);

CREATE TYPE "LoanDecisionSource" AS ENUM ('RULES', 'MODEL');

CREATE TABLE "LoanDecisionEvaluation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "classification" "LoanDecisionClassification" NOT NULL,
  "recommendedAction" "LoanDecisionAction" NOT NULL,
  "reasonCodes" TEXT[] NOT NULL,
  "source" "LoanDecisionSource" NOT NULL,
  "modelVersion" VARCHAR(64),
  "evaluatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoanDecisionEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoanDecisionReview" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "evaluationId" UUID NOT NULL,
  "reviewedByMembershipId" UUID NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoanDecisionReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoanDecisionEvaluation_organizationId_id_key"
ON "LoanDecisionEvaluation"("organizationId", "id");
CREATE INDEX "LoanDecisionEvaluation_organizationId_loanId_evaluatedAt_idx"
ON "LoanDecisionEvaluation"("organizationId", "loanId", "evaluatedAt");
CREATE INDEX "LoanDecisionEvaluation_organizationId_classification_evaluatedAt_idx"
ON "LoanDecisionEvaluation"("organizationId", "classification", "evaluatedAt");

CREATE UNIQUE INDEX "LoanDecisionReview_evaluationId_reviewedByMembershipId_key"
ON "LoanDecisionReview"("evaluationId", "reviewedByMembershipId");
CREATE INDEX "LoanDecisionReview_organizationId_loanId_reviewedAt_idx"
ON "LoanDecisionReview"("organizationId", "loanId", "reviewedAt");

ALTER TABLE "LoanDecisionEvaluation"
ADD CONSTRAINT "LoanDecisionEvaluation_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanDecisionEvaluation"
ADD CONSTRAINT "LoanDecisionEvaluation_organizationId_loanId_fkey"
FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoanDecisionReview"
ADD CONSTRAINT "LoanDecisionReview_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanDecisionReview"
ADD CONSTRAINT "LoanDecisionReview_organizationId_loanId_fkey"
FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanDecisionReview"
ADD CONSTRAINT "LoanDecisionReview_organizationId_evaluationId_fkey"
FOREIGN KEY ("organizationId", "evaluationId") REFERENCES "LoanDecisionEvaluation"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanDecisionReview"
ADD CONSTRAINT "LoanDecisionReview_organizationId_reviewedByMembershipId_fkey"
FOREIGN KEY ("organizationId", "reviewedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
