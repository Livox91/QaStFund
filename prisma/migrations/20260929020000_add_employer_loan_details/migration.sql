-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM (
  'LOAN_CREATED',
  'LOAN_ACTIVATED',
  'REPAYMENT_RECORDED',
  'LOAN_REPAID',
  'LOAN_OVERDUE'
);

-- AlterTable
ALTER TABLE "Loan"
ADD COLUMN "feeAmountMinorUnits" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD CONSTRAINT "Loan_fee_check" CHECK ("feeAmountMinorUnits" >= 0);

-- CreateTable
CREATE TABLE "LoanRepayment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "amountMinorUnits" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanRepayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoanRepayment_amount_check" CHECK ("amountMinorUnits" > 0),
    CONSTRAINT "LoanRepayment_currency_format_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "type" "AuditEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "actorLabel" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanRepayment_organizationId_loanId_paidAt_idx" ON "LoanRepayment"("organizationId", "loanId", "paidAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_loanId_occurredAt_idx" ON "AuditEvent"("organizationId", "loanId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_organizationId_id_key" ON "Loan"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "LoanRepayment" ADD CONSTRAINT "LoanRepayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRepayment" ADD CONSTRAINT "LoanRepayment_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_loanId_fkey" FOREIGN KEY ("organizationId", "loanId") REFERENCES "Loan"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
