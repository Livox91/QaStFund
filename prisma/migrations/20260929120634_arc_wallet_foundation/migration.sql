-- CreateEnum
CREATE TYPE "ArcWalletNetwork" AS ENUM ('ARC_TESTNET');

-- CreateEnum
CREATE TYPE "ArcWalletType" AS ENUM ('CIRCLE_MODULAR');

-- CreateEnum
CREATE TYPE "ArcWalletStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED');

-- CreateTable
CREATE TABLE "ArcWallet" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "address" VARCHAR(42),
    "network" "ArcWalletNetwork" NOT NULL DEFAULT 'ARC_TESTNET',
    "chainId" INTEGER NOT NULL DEFAULT 5042002,
    "walletType" "ArcWalletType" NOT NULL DEFAULT 'CIRCLE_MODULAR',
    "status" "ArcWalletStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArcWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArcWalletChallenge" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "address" VARCHAR(42) NOT NULL,
    "nonceHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArcWalletChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArcWallet_address_key" ON "ArcWallet"("address");

-- CreateIndex
CREATE INDEX "ArcWallet_organizationId_status_idx" ON "ArcWallet"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ArcWallet_userId_network_key" ON "ArcWallet"("userId", "network");

-- CreateIndex
CREATE UNIQUE INDEX "ArcWallet_organizationId_id_key" ON "ArcWallet"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ArcWalletChallenge_organizationId_userId_expiresAt_idx" ON "ArcWalletChallenge"("organizationId", "userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "ArcWallet" ADD CONSTRAINT "ArcWallet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcWallet" ADD CONSTRAINT "ArcWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcWalletChallenge" ADD CONSTRAINT "ArcWalletChallenge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcWalletChallenge" ADD CONSTRAINT "ArcWalletChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "LedgerTransaction_organizationId_referenceType_referenceId_type" RENAME TO "LedgerTransaction_organizationId_referenceType_referenceId__key";
