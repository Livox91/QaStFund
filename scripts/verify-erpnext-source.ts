import "dotenv/config";

import { createHash } from "node:crypto";

import { validateEnvironment } from "@/infrastructure/config/environment";
import { prisma } from "@/infrastructure/database/prisma";
import { EmployeeDirectoryError } from "@/modules/employee-directory/domain/employee-directory";
import { ErpNextEmployeeDirectoryAdapter } from "@/modules/employee-directory/infrastructure/erpnext-employee-directory-adapter";
import { PrismaEncryptedEmployeeDirectorySecretProvider } from "@/modules/employee-directory/infrastructure/encrypted-secret-provider";

const environment = validateEnvironment();
const integrations = await prisma.employeeDirectoryIntegration.findMany({
  where: { organization: { erpNextEnabled: true } },
  orderBy: { createdAt: "asc" },
  select: {
    organizationId: true,
    baseUrl: true,
    apiPath: true,
    apiVersion: true,
    authMethod: true,
    credentialReference: true,
    timeoutMs: true,
    mappings: {
      where: {
        OR: [{ matchStatus: { not: "MATCHED" } }, { normalizedStatus: null }],
      },
      orderBy: { createdAt: "asc" },
      select: { externalEmployeeId: true },
    },
  },
});
const secretProvider = new PrismaEncryptedEmployeeDirectorySecretProvider(
  environment.ERP_NEXT_CREDENTIAL_ENCRYPTION_KEY,
);
const results = [];
let ok = true;
for (const [index, integration] of integrations.entries()) {
  const adapter = new ErpNextEmployeeDirectoryAdapter(
    {
      organizationId: integration.organizationId,
      baseUrl: integration.baseUrl,
      apiPath: integration.apiPath,
      apiVersion: integration.apiVersion,
      authMethod: integration.authMethod === "TOKEN" ? "token" : "oauth_bearer",
      credentialReference: integration.credentialReference,
      timeoutMs: integration.timeoutMs,
    },
    secretProvider,
    {
      allowLocalDevelopment: environment.ERP_NEXT_ALLOW_LOCAL_HTTP,
      pageSize: environment.ERP_NEXT_SYNC_PAGE_SIZE,
    },
  );
  const connection = await adapter.testConnection();
  if (!connection.ok) ok = false;
  const records = [];
  for (const mapping of integration.mappings) {
    const fingerprint = createHash("sha256")
      .update(mapping.externalEmployeeId)
      .digest("hex")
      .slice(0, 12);
    try {
      const employee = await adapter.getEmployee(mapping.externalEmployeeId);
      records.push({
        sourceIdentifierFingerprint: fingerprint,
        found: Boolean(employee),
        emailPresent: Boolean(employee?.email),
        employeeCodePresent: Boolean(employee?.employeeCode),
        employmentStatus: employee?.employmentStatus ?? null,
        modifiedAt: employee?.modifiedAt ?? null,
      });
      if (!employee?.email) ok = false;
    } catch (error) {
      ok = false;
      records.push({
        sourceIdentifierFingerprint: fingerprint,
        found: false,
        code:
          error instanceof EmployeeDirectoryError
            ? error.code
            : "UNEXPECTED_ERROR",
      });
    }
  }
  results.push({ integration: index + 1, connection, reviewRecords: records });
}

console.log(
  JSON.stringify({ ok, readOnly: true, integrations: results }, null, 2),
);
await prisma.$disconnect();
if (!ok) process.exitCode = 1;
