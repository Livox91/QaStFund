CREATE TYPE "ArcUsdcTransferStatus" AS ENUM ('DRAFT', 'AWAITING_CONFIRMATION', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'UNKNOWN');

CREATE TABLE "ArcUsdcTransfer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(64) NOT NULL,
    "senderAddress" VARCHAR(42) NOT NULL,
    "recipientAddress" VARCHAR(42) NOT NULL,
    "amountBaseUnits" BIGINT NOT NULL,
    "chainId" INTEGER NOT NULL DEFAULT 5042002,
    "tokenAddress" VARCHAR(42) NOT NULL,
    "callDataHash" VARCHAR(66) NOT NULL,
    "status" "ArcUsdcTransferStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "userOperationHash" VARCHAR(66),
    "transactionHash" VARCHAR(66),
    "errorCode" VARCHAR(64),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArcUsdcTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArcUsdcTransfer_userOperationHash_key" ON "ArcUsdcTransfer"("userOperationHash");
CREATE UNIQUE INDEX "ArcUsdcTransfer_transactionHash_key" ON "ArcUsdcTransfer"("transactionHash");
CREATE UNIQUE INDEX "ArcUsdcTransfer_userId_idempotencyKey_key" ON "ArcUsdcTransfer"("userId", "idempotencyKey");
CREATE INDEX "ArcUsdcTransfer_userId_createdAt_idx" ON "ArcUsdcTransfer"("userId", "createdAt");
CREATE INDEX "ArcUsdcTransfer_status_updatedAt_idx" ON "ArcUsdcTransfer"("status", "updatedAt");
CREATE INDEX "ArcUsdcTransfer_walletId_createdAt_idx" ON "ArcUsdcTransfer"("walletId", "createdAt");

ALTER TABLE "ArcUsdcTransfer" ADD CONSTRAINT "ArcUsdcTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArcUsdcTransfer" ADD CONSTRAINT "ArcUsdcTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArcUsdcTransfer" ADD CONSTRAINT "ArcUsdcTransfer_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "ArcWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
