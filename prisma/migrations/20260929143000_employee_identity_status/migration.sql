-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TERMINATED');

-- AlterTable
ALTER TABLE "OrganizationMembership"
ADD COLUMN "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE';

-- Preserve the meaning of existing inactive memberships.
UPDATE "OrganizationMembership"
SET "employmentStatus" = 'SUSPENDED'
WHERE "isActive" = false;
