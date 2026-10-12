CREATE TYPE "OperationalIncidentSeverity" AS ENUM ('WARNING', 'CRITICAL');
CREATE TYPE "OperationalIncidentStatus" AS ENUM ('ACTIVE', 'RECOVERED');

CREATE TABLE "OperationalIncident" (
    "id" UUID NOT NULL,
    "deduplicationKey" VARCHAR(180) NOT NULL,
    "organizationId" UUID,
    "subsystem" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(96) NOT NULL,
    "severity" "OperationalIncidentSeverity" NOT NULL,
    "status" "OperationalIncidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "safeReferenceId" VARCHAR(128) NOT NULL,
    "summary" VARCHAR(240) NOT NULL,
    "remediation" VARCHAR(500) NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "recoveredAt" TIMESTAMP(3),
    "deliveryPending" BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveryAttemptAt" TIMESTAMP(3),
    "lastDeliveredAt" TIMESTAMP(3),
    "lastDeliveryFailedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperationalIncident_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalJobHeartbeat" (
    "jobKey" VARCHAR(96) NOT NULL,
    "subsystem" VARCHAR(64) NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "lastAttemptedAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "nextExpectedAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSafeErrorCode" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperationalJobHeartbeat_pkey" PRIMARY KEY ("jobKey")
);

CREATE UNIQUE INDEX "OperationalIncident_deduplicationKey_key" ON "OperationalIncident"("deduplicationKey");
CREATE INDEX "OperationalIncident_status_severity_lastDetectedAt_idx" ON "OperationalIncident"("status", "severity", "lastDetectedAt");
CREATE INDEX "OperationalIncident_organizationId_safeReferenceId_lastDetectedAt_idx" ON "OperationalIncident"("organizationId", "safeReferenceId", "lastDetectedAt");
CREATE INDEX "OperationalIncident_deliveryPending_lastDeliveryFailedAt_idx" ON "OperationalIncident"("deliveryPending", "lastDeliveryFailedAt");
CREATE INDEX "OperationalJobHeartbeat_nextExpectedAt_idx" ON "OperationalJobHeartbeat"("nextExpectedAt");
CREATE INDEX "OperationalJobHeartbeat_subsystem_lastSucceededAt_idx" ON "OperationalJobHeartbeat"("subsystem", "lastSucceededAt");

ALTER TABLE "OperationalIncident"
ADD CONSTRAINT "OperationalIncident_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
