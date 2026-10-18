ALTER TABLE "EmployeeDirectoryMapping"
ADD COLUMN "employmentStartedAt" TIMESTAMP(3);

DROP INDEX "DelinquencyNotification_caseId_thresholdKey_key";

CREATE UNIQUE INDEX "DelinquencyNotification_caseId_thresholdKey_recipientMembershipId_key"
ON "DelinquencyNotification"("caseId", "thresholdKey", "recipientMembershipId");
