-- These tables were introduced during local development but never populated.
-- Milestone 1 retains only repayment schedules and allocation records.
ALTER TABLE "LoanRepayment"
DROP CONSTRAINT IF EXISTS "LoanRepayment_organizationId_payrollDeductionProposalId_fkey";

DROP INDEX IF EXISTS "LoanRepayment_organizationId_payrollDeductionProposalId_idx";

ALTER TABLE "LoanRepayment"
DROP COLUMN IF EXISTS "payrollDeductionProposalId";

DROP TABLE "PayrollDeductionProposal";
DROP TABLE "DelinquencyNotification";
DROP TABLE "RepaymentArrangement";

DROP TYPE "PayrollDeductionStatus";
DROP TYPE "EmployeeDeductionAuthorizationStatus";
DROP TYPE "DelinquencyNotificationStatus";
DROP TYPE "RepaymentArrangementStatus";
