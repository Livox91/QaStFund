CREATE TYPE "RepaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'REPAYMENT_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'REPAYMENT_COMPLETED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'LOAN_MARKED_OVERDUE';

ALTER TABLE "LoanRepayment"
  ADD COLUMN "status" "RepaymentStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "completedAt" TIMESTAMP(3);

UPDATE "LoanRepayment" SET "completedAt" = "paidAt";

ALTER TABLE "LoanRepayment"
  ADD CONSTRAINT "LoanRepayment_completion_check" CHECK (
    ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
  );

ALTER TABLE "AuditEvent" ADD COLUMN "repaymentId" UUID;

CREATE INDEX "AuditEvent_organizationId_repaymentId_occurredAt_idx"
  ON "AuditEvent"("organizationId", "repaymentId", "occurredAt");

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_organizationId_repaymentId_fkey"
  FOREIGN KEY ("organizationId", "repaymentId")
  REFERENCES "LoanRepayment"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
