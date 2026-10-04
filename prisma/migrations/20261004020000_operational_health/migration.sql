ALTER TABLE "BlockchainReconciliationCursor"
ADD COLUMN "latestObservedBlock" BIGINT,
ADD COLUMN "lastSuccessfulAt" TIMESTAMP(3),
ADD COLUMN "lastFailureAt" TIMESTAMP(3),
ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
