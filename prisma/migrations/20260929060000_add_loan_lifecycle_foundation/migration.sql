-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'LOAN_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE 'LOAN_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE 'LOAN_DEFAULTED';
ALTER TYPE "AuditEventType" ADD VALUE 'LOAN_CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LoanStatus" ADD VALUE 'REQUESTED';
ALTER TYPE "LoanStatus" ADD VALUE 'APPROVED';
