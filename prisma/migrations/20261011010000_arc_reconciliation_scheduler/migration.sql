CREATE TYPE "ReconciliationAlertState" AS ENUM ('HEALTHY', 'STALE', 'FAILING');

ALTER TABLE "BlockchainReconciliationCursor"
ADD COLUMN "alertState" "ReconciliationAlertState" NOT NULL DEFAULT 'HEALTHY',
ADD COLUMN "alertChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "alertDeliveryPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastAlertAttemptAt" TIMESTAMP(3),
ADD COLUMN "lastAlertDeliveredAt" TIMESTAMP(3),
ADD COLUMN "lastAlertFailedAt" TIMESTAMP(3);
