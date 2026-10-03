CREATE TYPE "EmployeeDirectorySyncTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

ALTER TABLE "EmployeeDirectoryIntegration"
ADD COLUMN "scheduledSyncPausedAt" TIMESTAMP(3),
ADD COLUMN "schedulePauseCode" VARCHAR(64);

ALTER TABLE "EmployeeDirectorySyncRun"
ALTER COLUMN "requestedByMembershipId" DROP NOT NULL,
ADD COLUMN "trigger" "EmployeeDirectorySyncTrigger" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "processedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "createdCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "updatedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "unchangedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reviewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "safeErrorSummary" VARCHAR(240),
ADD COLUMN "durationMs" INTEGER;

CREATE INDEX "EmployeeDirectorySyncRun_organizationId_trigger_startedAt_idx"
ON "EmployeeDirectorySyncRun"("organizationId", "trigger", "startedAt");
