ALTER TABLE "LoanRepayment"
ADD COLUMN "payrollDeductionProposalId" UUID;

ALTER TABLE "PayrollDeductionProposal"
DROP CONSTRAINT IF EXISTS "PayrollDeductionProposal_organizationId_repaymentId_fkey";

DROP INDEX IF EXISTS "PayrollDeductionProposal_repaymentId_key";
DROP INDEX IF EXISTS "PayrollDeductionProposal_organizationId_repaymentId_key";

ALTER TABLE "PayrollDeductionProposal"
DROP COLUMN "repaymentId";

CREATE INDEX "LoanRepayment_organizationId_payrollDeductionProposalId_idx"
ON "LoanRepayment"("organizationId", "payrollDeductionProposalId");

ALTER TABLE "LoanRepayment"
ADD CONSTRAINT "LoanRepayment_organizationId_payrollDeductionProposalId_fkey"
FOREIGN KEY ("organizationId", "payrollDeductionProposalId")
REFERENCES "PayrollDeductionProposal"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
