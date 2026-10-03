import type { EmploymentStatus } from "@/generated/prisma/client";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { EmployeeDirectoryRepository } from "@/modules/employee-directory/application/ports/employee-directory-repository";
import type {
  EmployeeDirectoryAuthMethod,
  EmployeeDirectoryConfig,
} from "@/modules/employee-directory/domain/employee-directory";
import {
  type HostResolver,
  validateErpNextBaseUrl,
} from "@/modules/employee-directory/infrastructure/erpnext-url-security";

export async function configureEmployeeDirectory(
  actor: AuthenticatedActor | null,
  input: {
    baseUrl: string;
    apiPath: string;
    apiVersion: string;
    authMethod: EmployeeDirectoryAuthMethod;
    credentialReference: string;
    timeoutMs: number;
    statusMapping: Readonly<Record<string, EmploymentStatus | null>>;
  },
  repository: EmployeeDirectoryRepository,
  options: { resolver?: HostResolver; allowLocalDevelopment?: boolean } = {},
) {
  const employer = requireEmployerAdmin(actor);
  const url = await validateErpNextBaseUrl(
    input.baseUrl,
    options.resolver,
    options.allowLocalDevelopment,
  );
  if (
    !/^\/[a-zA-Z0-9/_.{}-]+$/.test(input.apiPath) ||
    input.apiPath.includes("..") ||
    input.apiPath.replaceAll("{version}", "").includes("{") ||
    input.apiPath.replaceAll("{version}", "").includes("}")
  ) {
    throw new Error("INVALID_API_PATH");
  }
  if (!/^[a-zA-Z0-9._-]{1,16}$/.test(input.apiVersion)) {
    throw new Error("INVALID_API_VERSION");
  }
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(input.credentialReference)) {
    throw new Error("INVALID_CREDENTIAL_REFERENCE");
  }
  if (
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 500 ||
    input.timeoutMs > 30_000
  ) {
    throw new Error("INVALID_TIMEOUT");
  }
  const config: EmployeeDirectoryConfig = {
    organizationId: employer.organizationId,
    baseUrl: url.toString().replace(/\/$/, ""),
    apiPath: input.apiPath.replace(/\/$/, ""),
    apiVersion: input.apiVersion,
    authMethod: input.authMethod,
    credentialReference: input.credentialReference,
    timeoutMs: input.timeoutMs,
  };
  await repository.saveIntegration({
    ...config,
    statusMapping: input.statusMapping,
  });
}
