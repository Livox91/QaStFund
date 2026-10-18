import "dotenv/config";
import "server-only";

import { validateEnvironment } from "@/infrastructure/config/environment";
import { prisma } from "@/infrastructure/database/prisma";
import { PrismaEncryptedEmployeeDirectorySecretProvider } from "@/modules/employee-directory/infrastructure/encrypted-secret-provider";
import { validateErpNextBaseUrl } from "@/modules/employee-directory/infrastructure/erpnext-url-security";

const environment = validateEnvironment();
const integrations = await prisma.employeeDirectoryIntegration.findMany({
  where: { organization: { erpNextEnabled: true } },
  select: {
    organizationId: true,
    baseUrl: true,
    apiPath: true,
    authMethod: true,
    credentialReference: true,
    timeoutMs: true,
  },
});
const provider = new PrismaEncryptedEmployeeDirectorySecretProvider(
  environment.ERP_NEXT_CREDENTIAL_ENCRYPTION_KEY,
);
const doctypes = [
  "Employee",
  "Company",
  "Department",
  "Salary Component",
  "Salary Structure",
  "Salary Structure Assignment",
  "Payroll Entry",
  "Salary Slip",
] as const;
const results = [];
for (const [index, integration] of integrations.entries()) {
  const base = await validateErpNextBaseUrl(
    integration.baseUrl,
    undefined,
    environment.ERP_NEXT_ALLOW_LOCAL_HTTP,
  );
  const secret = await provider.getSecret({
    organizationId: integration.organizationId,
    reference: integration.credentialReference,
    authMethod: integration.authMethod === "TOKEN" ? "token" : "oauth_bearer",
  });
  const authorization =
    secret.method === "token"
      ? `token ${secret.apiKey}:${secret.apiSecret}`
      : `Bearer ${secret.accessToken}`;
  async function get(path: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), integration.timeoutMs);
    try {
      const response = await fetch(new URL(path, base.origin), {
        headers: { Accept: "application/json", Authorization: authorization },
        redirect: "manual",
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      return { status: response.status, body };
    } catch {
      return { status: 0, body: null };
    } finally {
      clearTimeout(timer);
    }
  }
  const access: Record<string, { status: number; hasRecords: boolean }> = {};
  const path = `/${integration.apiPath.replace(/^\/+|\/+$/g, "")}`;
  for (const doctype of doctypes) {
    const probe = await get(
      `${path}/${encodeURIComponent(doctype)}?fields=${encodeURIComponent('["name"]')}&limit_page_length=1`,
    );
    const data =
      probe.body && typeof probe.body === "object" && "data" in probe.body
        ? (probe.body as { data: unknown }).data
        : null;
    access[doctype] = {
      status: probe.status,
      hasRecords: Array.isArray(data) && data.length > 0,
    };
  }
  const versionProbe = await get(
    "/api/method/frappe.utils.change_log.get_versions",
  );
  const rawVersions =
    versionProbe.body &&
    typeof versionProbe.body === "object" &&
    "message" in versionProbe.body
      ? (versionProbe.body as { message: unknown }).message
      : null;
  const versionItems = Array.isArray(rawVersions)
    ? rawVersions
    : rawVersions && typeof rawVersions === "object"
      ? Object.entries(rawVersions).map(([app, value]) =>
          value && typeof value === "object"
            ? { app_name: app, ...(value as Record<string, unknown>) }
            : { app_name: app, version: value },
        )
      : [];
  const versions = versionItems
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    )
    .map((item) => ({
      app: typeof item.app_name === "string" ? item.app_name : null,
      version: typeof item.version === "string" ? item.version : null,
      branch: typeof item.branch === "string" ? item.branch : null,
    }))
    .filter((item) => item.app && item.version);
  results.push({
    integration: index + 1,
    versionEndpointStatus: versionProbe.status,
    versions,
    readAccessStatus: access,
    payrollCredentialConfigured: Boolean(
      process.env.ERP_NEXT_PAYROLL_CREDENTIALS_JSON,
    ),
  });
}
console.log(JSON.stringify({ readOnly: true, integrations: results }, null, 2));
await prisma.$disconnect();
