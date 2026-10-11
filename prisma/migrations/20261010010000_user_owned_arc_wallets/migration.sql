-- Arc wallets are controlled by a user's passkey and must survive organization
-- changes. Organization-specific ownership proofs remain in ArcWalletChallenge.
DROP INDEX IF EXISTS "ArcWallet_organizationId_status_idx";
DROP INDEX IF EXISTS "ArcWallet_organizationId_id_key";

ALTER TABLE "ArcWallet"
  DROP CONSTRAINT IF EXISTS "ArcWallet_organizationId_fkey";

ALTER TABLE "ArcWallet"
  DROP COLUMN "organizationId";

CREATE INDEX "ArcWallet_status_idx" ON "ArcWallet"("status");
