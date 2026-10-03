CREATE TYPE "EmploymentStatusSource" AS ENUM ('ERPNEXT');
CREATE TYPE "EmployeeDirectoryProvider" AS ENUM ('ERPNEXT');
CREATE TYPE "EmployeeDirectoryAuthMethod" AS ENUM ('TOKEN', 'OAUTH_BEARER');
CREATE TYPE "EmployeeDirectoryConnectionStatus" AS ENUM ('NOT_TESTED', 'CONNECTED', 'FAILED');
CREATE TYPE "EmployeeDirectorySyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');
CREATE TYPE "EmployeeDirectoryMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'DUPLICATE_EXTERNAL_ID');
CREATE TYPE "EmployeeDirectoryMatchMethod" AS ENUM ('UNIQUE_EMAIL', 'EXPLICIT');

ALTER TYPE "AuditEventType" ADD VALUE 'EMPLOYEE_DIRECTORY_SYNC_COMPLETED';
ALTER TYPE "AuditEventType" ADD VALUE 'EMPLOYEE_DIRECTORY_SYNC_FAILED';

ALTER TABLE "OrganizationMembership"
ADD COLUMN "employmentStatusSource" "EmploymentStatusSource",
ADD COLUMN "employmentStatusSyncedAt" TIMESTAMP(3);

CREATE TABLE "EmployeeDirectoryIntegration" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "provider" "EmployeeDirectoryProvider" NOT NULL DEFAULT 'ERPNEXT',
  "baseUrl" VARCHAR(512) NOT NULL,
  "apiPath" VARCHAR(128) NOT NULL DEFAULT '/api/resource',
  "apiVersion" VARCHAR(16) NOT NULL DEFAULT 'v1',
  "authMethod" "EmployeeDirectoryAuthMethod" NOT NULL,
  "credentialReference" VARCHAR(128) NOT NULL,
  "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
  "statusMapping" JSONB NOT NULL,
  "connectionStatus" "EmployeeDirectoryConnectionStatus" NOT NULL DEFAULT 'NOT_TESTED',
  "lastConnectionCode" VARCHAR(64),
  "lastTestedAt" TIMESTAMP(3),
  "lastSuccessfulSyncAt" TIMESTAMP(3),
  "lastSyncStatus" "EmployeeDirectorySyncStatus",
  "lastSyncErrorCode" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeDirectoryIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeDirectoryMapping" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "integrationId" UUID NOT NULL,
  "externalEmployeeId" VARCHAR(140) NOT NULL,
  "employeeCode" VARCHAR(140),
  "fullName" VARCHAR(280) NOT NULL,
  "email" VARCHAR(320),
  "externalStatus" VARCHAR(128) NOT NULL,
  "normalizedStatus" "EmploymentStatus",
  "matchStatus" "EmployeeDirectoryMatchStatus" NOT NULL,
  "matchMethod" "EmployeeDirectoryMatchMethod",
  "matchedMembershipId" UUID,
  "lastSynchronizedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeDirectoryMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeDirectorySyncRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "integrationId" UUID NOT NULL,
  "requestedByMembershipId" UUID NOT NULL,
  "status" "EmployeeDirectorySyncStatus" NOT NULL DEFAULT 'RUNNING',
  "retrievedCount" INTEGER NOT NULL DEFAULT 0,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
  "ambiguousCount" INTEGER NOT NULL DEFAULT 0,
  "statusChangeCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "safeErrorCode" VARCHAR(64),
  "correlationId" UUID NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeDirectorySyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeDirectoryIntegration_organizationId_key" ON "EmployeeDirectoryIntegration"("organizationId");
CREATE UNIQUE INDEX "EmployeeDirectoryIntegration_organizationId_id_key" ON "EmployeeDirectoryIntegration"("organizationId", "id");
CREATE UNIQUE INDEX "EmployeeDirectoryMapping_organizationId_integrationId_externalEmployeeId_key" ON "EmployeeDirectoryMapping"("organizationId", "integrationId", "externalEmployeeId");
CREATE UNIQUE INDEX "EmployeeDirectoryMapping_organizationId_integrationId_matchedMembershipId_key" ON "EmployeeDirectoryMapping"("organizationId", "integrationId", "matchedMembershipId");
CREATE INDEX "EmployeeDirectoryMapping_organizationId_matchStatus_idx" ON "EmployeeDirectoryMapping"("organizationId", "matchStatus");
CREATE UNIQUE INDEX "EmployeeDirectorySyncRun_organizationId_id_key" ON "EmployeeDirectorySyncRun"("organizationId", "id");
CREATE INDEX "EmployeeDirectorySyncRun_organizationId_startedAt_idx" ON "EmployeeDirectorySyncRun"("organizationId", "startedAt");
CREATE UNIQUE INDEX "EmployeeDirectorySyncRun_one_running_per_organization" ON "EmployeeDirectorySyncRun"("organizationId") WHERE "status" = 'RUNNING';

ALTER TABLE "EmployeeDirectoryIntegration" ADD CONSTRAINT "EmployeeDirectoryIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeDirectoryMapping" ADD CONSTRAINT "EmployeeDirectoryMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeDirectoryMapping" ADD CONSTRAINT "EmployeeDirectoryMapping_organizationId_integrationId_fkey" FOREIGN KEY ("organizationId", "integrationId") REFERENCES "EmployeeDirectoryIntegration"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeDirectoryMapping" ADD CONSTRAINT "EmployeeDirectoryMapping_organizationId_matchedMembershipId_fkey" FOREIGN KEY ("organizationId", "matchedMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeDirectorySyncRun" ADD CONSTRAINT "EmployeeDirectorySyncRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeDirectorySyncRun" ADD CONSTRAINT "EmployeeDirectorySyncRun_organizationId_integrationId_fkey" FOREIGN KEY ("organizationId", "integrationId") REFERENCES "EmployeeDirectoryIntegration"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeDirectorySyncRun" ADD CONSTRAINT "EmployeeDirectorySyncRun_organizationId_requestedByMembershipId_fkey" FOREIGN KEY ("organizationId", "requestedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
