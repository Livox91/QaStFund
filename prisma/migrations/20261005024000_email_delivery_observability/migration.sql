CREATE TYPE "EmailDeliveryStatus" AS ENUM ('CREATED', 'SENT', 'FAILED');

ALTER TABLE "EmployeeInvitation"
  ADD COLUMN "deliveryStatus" "EmailDeliveryStatus" NOT NULL DEFAULT 'CREATED';

UPDATE "EmployeeInvitation"
SET "deliveryStatus" = CASE
  WHEN "sentAt" IS NOT NULL THEN 'SENT'::"EmailDeliveryStatus"
  WHEN "deliveryFailureCode" IS NOT NULL THEN 'FAILED'::"EmailDeliveryStatus"
  ELSE 'CREATED'::"EmailDeliveryStatus"
END;

ALTER TABLE "PasswordResetToken"
  ADD COLUMN "deliveryStatus" "EmailDeliveryStatus" NOT NULL DEFAULT 'CREATED',
  ADD COLUMN "deliveryFailureCode" VARCHAR(64);

UPDATE "PasswordResetToken"
SET "deliveryStatus" = CASE
  WHEN "sentAt" IS NOT NULL THEN 'SENT'::"EmailDeliveryStatus"
  ELSE 'CREATED'::"EmailDeliveryStatus"
END;

ALTER TABLE "EmployeeDirectorySyncRun"
  ADD COLUMN "invitationCreatedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "invitationSentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "invitationFailureCount" INTEGER NOT NULL DEFAULT 0;
