CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

ALTER TYPE "AuditEventType" ADD VALUE 'EMPLOYEE_INVITATION_SENT';
ALTER TYPE "AuditEventType" ADD VALUE 'EMPLOYEE_INVITATION_ACCEPTED';
ALTER TYPE "AuditEventType" ADD VALUE 'EMPLOYEE_INVITATION_REVOKED';
ALTER TYPE "AuditEventType" ADD VALUE 'PASSWORD_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE 'PASSWORD_RESET';

ALTER TABLE "OrganizationMembership" ADD COLUMN "accountActivatedAt" TIMESTAMP(3);
UPDATE "OrganizationMembership" SET "accountActivatedAt" = "createdAt" WHERE "isActive" = true;

CREATE TABLE "EmployeeInvitation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "employeeMembershipId" UUID NOT NULL, "email" VARCHAR(320) NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL, "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "sentAt" TIMESTAMP(3),
  "deliveryFailureCode" VARCHAR(64), "invitedByMembershipId" UUID,
  CONSTRAINT "EmployeeInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordResetToken" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "membershipId" UUID NOT NULL, "userId" UUID NOT NULL, "email" VARCHAR(320) NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3), "sentAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeInvitation_tokenHash_key" ON "EmployeeInvitation"("tokenHash");
CREATE UNIQUE INDEX "EmployeeInvitation_organizationId_id_key" ON "EmployeeInvitation"("organizationId", "id");
CREATE INDEX "EmployeeInvitation_organizationId_employeeMembershipId_status_idx" ON "EmployeeInvitation"("organizationId", "employeeMembershipId", "status");
CREATE INDEX "EmployeeInvitation_expiresAt_status_idx" ON "EmployeeInvitation"("expiresAt", "status");
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE UNIQUE INDEX "PasswordResetToken_organizationId_id_key" ON "PasswordResetToken"("organizationId", "id");
CREATE INDEX "PasswordResetToken_organizationId_membershipId_expiresAt_idx" ON "PasswordResetToken"("organizationId", "membershipId", "expiresAt");
CREATE INDEX "PasswordResetToken_expiresAt_usedAt_revokedAt_idx" ON "PasswordResetToken"("expiresAt", "usedAt", "revokedAt");

ALTER TABLE "EmployeeInvitation" ADD CONSTRAINT "EmployeeInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeInvitation" ADD CONSTRAINT "EmployeeInvitation_organizationId_employeeMembershipId_fkey" FOREIGN KEY ("organizationId", "employeeMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeInvitation" ADD CONSTRAINT "EmployeeInvitation_organizationId_invitedByMembershipId_fkey" FOREIGN KEY ("organizationId", "invitedByMembershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_organizationId_membershipId_fkey" FOREIGN KEY ("organizationId", "membershipId") REFERENCES "OrganizationMembership"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
