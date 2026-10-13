ALTER TABLE "DelinquencyCase"
ADD COLUMN "arrangementRequestedAt" TIMESTAMP(3),
ADD COLUMN "arrangementRequestedByMembershipId" UUID,
ADD COLUMN "arrangementRequestNote" VARCHAR(1000);

CREATE UNIQUE INDEX "PayrollDeductionProposal_organizationId_erpNextDocumentReference_key"
ON "PayrollDeductionProposal"("organizationId", "erpNextDocumentReference");

ALTER TABLE "DelinquencyCase"
ADD CONSTRAINT "DelinquencyCase_organizationId_arrangementRequestedByMembershipId_fkey"
FOREIGN KEY ("organizationId", "arrangementRequestedByMembershipId")
REFERENCES "OrganizationMembership"("organizationId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
