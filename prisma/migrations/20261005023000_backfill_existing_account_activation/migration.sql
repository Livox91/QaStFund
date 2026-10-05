-- Memberships created before invitation onboarding already represented accounts,
-- including inactive former employees. Preserve that state for rehire. New
-- unclaimed employees have an invitation and are deliberately excluded.
UPDATE "OrganizationMembership" AS membership
SET "accountActivatedAt" = membership."createdAt"
WHERE membership."accountActivatedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "EmployeeInvitation" AS invitation
    WHERE invitation."organizationId" = membership."organizationId"
      AND invitation."employeeMembershipId" = membership."id"
  );
