-- CreateEnum
CREATE TYPE "ArcWalletEnrollmentState" AS ENUM ('NOT_STARTED', 'REGISTERING', 'REGISTERED', 'VERIFYING', 'ACTIVE', 'FAILED_RECOVERABLE');

-- AlterTable
ALTER TABLE "ArcWallet" ADD COLUMN     "enrollmentState" "ArcWalletEnrollmentState" NOT NULL DEFAULT 'NOT_STARTED';
