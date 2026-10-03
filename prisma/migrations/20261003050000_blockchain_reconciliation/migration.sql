CREATE TYPE "BlockchainEventName" AS ENUM (
  'OFFER_CREATED',
  'LOAN_STARTED',
  'LOAN_REPAID'
);

CREATE TYPE "BlockchainEventStatus" AS ENUM (
  'PROVISIONAL',
  'APPLIED',
  'UNMATCHED',
  'CONFLICT',
  'REORGED'
);

CREATE TABLE "BlockchainReconciliationCursor" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chainId" INTEGER NOT NULL,
  "contractAddress" VARCHAR(42) NOT NULL,
  "nextBlock" BIGINT NOT NULL,
  "finalizedThrough" BIGINT NOT NULL,
  "leaseOwner" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlockchainReconciliationCursor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlockchainEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chainId" INTEGER NOT NULL,
  "contractAddress" VARCHAR(42) NOT NULL,
  "blockNumber" BIGINT NOT NULL,
  "blockHash" VARCHAR(66) NOT NULL,
  "transactionHash" VARCHAR(66) NOT NULL,
  "logIndex" INTEGER NOT NULL,
  "name" "BlockchainEventName" NOT NULL,
  "status" "BlockchainEventStatus" NOT NULL DEFAULT 'PROVISIONAL',
  "isFinalized" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB NOT NULL,
  "organizationId" UUID,
  "matchedRecordId" UUID,
  "investigationCode" VARCHAR(64),
  "investigationNote" VARCHAR(240),
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlockchainEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlockchainReconciliationCursor_chainId_contractAddress_key"
ON "BlockchainReconciliationCursor"("chainId", "contractAddress");

CREATE UNIQUE INDEX "BlockchainEvent_chain_contract_transaction_log_key"
ON "BlockchainEvent"("chainId", "contractAddress", "transactionHash", "logIndex");

CREATE INDEX "BlockchainEvent_chain_contract_block_idx"
ON "BlockchainEvent"("chainId", "contractAddress", "blockNumber");

CREATE INDEX "BlockchainEvent_ready_idx"
ON "BlockchainEvent"("chainId", "contractAddress", "isFinalized", "status", "blockNumber");

CREATE INDEX "BlockchainEvent_status_updatedAt_idx"
ON "BlockchainEvent"("status", "updatedAt");
