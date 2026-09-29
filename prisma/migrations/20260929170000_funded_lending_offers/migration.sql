-- CreateEnum
CREATE TYPE "LendingOfferFundingStatus" AS ENUM ('LEGACY', 'PENDING', 'FUNDED', 'FAILED');

-- AlterTable
ALTER TABLE "LendingOffer"
ADD COLUMN "fundingStatus" "LendingOfferFundingStatus" NOT NULL DEFAULT 'LEGACY',
ADD COLUMN "fundingRequestId" UUID,
ADD COLUMN "lenderWalletAddress" VARCHAR(42),
ADD COLUMN "principalBaseUnits" BIGINT,
ADD COLUMN "chainOfferId" VARCHAR(78),
ADD COLUMN "contractAddress" VARCHAR(42),
ADD COLUMN "fundingTransactionHash" VARCHAR(66),
ADD COLUMN "fundedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "LendingOffer_fundingRequestId_key" ON "LendingOffer"("fundingRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "LendingOffer_fundingTransactionHash_key" ON "LendingOffer"("fundingTransactionHash");

-- CreateIndex
CREATE INDEX "LendingOffer_organizationId_fundingStatus_status_idx"
ON "LendingOffer"("organizationId", "fundingStatus", "status");
