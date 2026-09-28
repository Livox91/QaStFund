-- Add immutable lifecycle milestones. Existing loans predate this lifecycle,
-- so backfill their milestones from the dates already stored on each row.
ALTER TABLE "Loan"
  ADD COLUMN "requestedAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3);

UPDATE "Loan"
SET
  "requestedAt" = "createdAt",
  "approvedAt" = CASE
    WHEN "status" IN ('ACTIVE', 'OVERDUE', 'REPAID', 'DEFAULTED')
      THEN "startedAt"
    ELSE NULL
  END,
  "activatedAt" = CASE
    WHEN "status" IN ('ACTIVE', 'OVERDUE', 'REPAID', 'DEFAULTED')
      THEN "startedAt"
    ELSE NULL
  END,
  "closedAt" = CASE
    WHEN "status" IN ('REPAID', 'DEFAULTED', 'CANCELLED')
      THEN "updatedAt"
    ELSE NULL
  END;

ALTER TABLE "Loan"
  ALTER COLUMN "requestedAt" SET NOT NULL,
  ALTER COLUMN "requestedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "Loan_lifecycle_order_check" CHECK (
    ("approvedAt" IS NULL OR "approvedAt" >= "requestedAt")
    AND ("activatedAt" IS NULL OR ("approvedAt" IS NOT NULL AND "activatedAt" >= "approvedAt"))
    AND ("closedAt" IS NULL OR "closedAt" >= "requestedAt")
  ),
  ADD CONSTRAINT "Loan_status_milestones_check" CHECK (
    ("status" = 'REQUESTED' AND "approvedAt" IS NULL AND "activatedAt" IS NULL AND "closedAt" IS NULL)
    OR ("status" = 'APPROVED' AND "approvedAt" IS NOT NULL AND "activatedAt" IS NULL AND "closedAt" IS NULL)
    OR ("status" IN ('ACTIVE', 'OVERDUE') AND "approvedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "closedAt" IS NULL)
    OR ("status" IN ('REPAID', 'DEFAULTED') AND "approvedAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "closedAt" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "closedAt" IS NOT NULL)
  );

-- Retain both an immutable actor label and, when the actor is an employee,
-- a tenant-scoped foreign key to the membership responsible for the event.
ALTER TABLE "AuditEvent" ADD COLUMN "actorMembershipId" UUID;

CREATE INDEX "AuditEvent_organizationId_actorMembershipId_occurredAt_idx"
  ON "AuditEvent"("organizationId", "actorMembershipId", "occurredAt");
CREATE INDEX "Loan_organizationId_lenderMembershipId_status_idx"
  ON "Loan"("organizationId", "lenderMembershipId", "status");
CREATE INDEX "Loan_organizationId_borrowerMembershipId_status_idx"
  ON "Loan"("organizationId", "borrowerMembershipId", "status");

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_organizationId_actorMembershipId_fkey"
  FOREIGN KEY ("organizationId", "actorMembershipId")
  REFERENCES "OrganizationMembership"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
