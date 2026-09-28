ALTER TYPE "LedgerTransactionType" ADD VALUE 'LOAN_REPAYMENT';

DROP INDEX "LedgerTransaction_loanId_key";
DROP INDEX "LedgerTransaction_organizationId_loanId_key";

ALTER TABLE "LedgerTransaction" ADD COLUMN "repaymentId" UUID;
ALTER TABLE "LoanRepayment" ADD COLUMN "repaymentRequestId" UUID;

ALTER TABLE "LoanRepayment"
  ADD CONSTRAINT "LoanRepayment_positive_amount_check" CHECK ("amountMinorUnits" > 0);

CREATE UNIQUE INDEX "LedgerTransaction_repaymentId_key" ON "LedgerTransaction"("repaymentId");
CREATE INDEX "LedgerTransaction_organizationId_loanId_idx" ON "LedgerTransaction"("organizationId", "loanId");
CREATE UNIQUE INDEX "LedgerTransaction_organizationId_repaymentId_key" ON "LedgerTransaction"("organizationId", "repaymentId");
CREATE UNIQUE INDEX "LedgerTransaction_one_disbursement_per_loan_idx" ON "LedgerTransaction"("organizationId", "loanId") WHERE "type" = 'LOAN_DISBURSEMENT';
CREATE UNIQUE INDEX "LoanRepayment_repaymentRequestId_key" ON "LoanRepayment"("repaymentRequestId");
CREATE UNIQUE INDEX "LoanRepayment_organizationId_id_key" ON "LoanRepayment"("organizationId", "id");

ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_organizationId_repaymentId_fkey" FOREIGN KEY ("organizationId", "repaymentId") REFERENCES "LoanRepayment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
