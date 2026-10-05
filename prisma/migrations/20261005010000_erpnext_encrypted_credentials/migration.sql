CREATE TABLE "EmployeeDirectoryCredentialSecret" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "authMethod" "EmployeeDirectoryAuthMethod" NOT NULL,
  "encryptedPayload" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmployeeDirectoryCredentialSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeDirectoryCredentialSecret_organizationId_id_key"
ON "EmployeeDirectoryCredentialSecret"("organizationId", "id");

CREATE INDEX "EmployeeDirectoryCredentialSecret_organizationId_idx"
ON "EmployeeDirectoryCredentialSecret"("organizationId");

ALTER TABLE "EmployeeDirectoryCredentialSecret"
ADD CONSTRAINT "EmployeeDirectoryCredentialSecret_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
