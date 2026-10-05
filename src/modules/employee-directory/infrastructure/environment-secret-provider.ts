import "server-only";

import type {
  EmployeeDirectoryAuthMethod,
  EmployeeDirectorySecret,
  EmployeeDirectorySecretProvider,
} from "@/modules/employee-directory/domain/employee-directory";
import { EmployeeDirectoryError } from "@/modules/employee-directory/domain/employee-directory";

type StoredSecret = {
  apiKey?: unknown;
  apiSecret?: unknown;
  accessToken?: unknown;
};

function readSecretMap(): Record<string, Record<string, StoredSecret>> {
  const raw = process.env.ERP_NEXT_CREDENTIALS_JSON;
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object"
      ? (value as Record<string, Record<string, StoredSecret>>)
      : {};
  } catch {
    throw new EmployeeDirectoryError("MISSING_CREDENTIALS");
  }
}

function tokenSecret(value: StoredSecret): EmployeeDirectorySecret | null {
  return typeof value.apiKey === "string" &&
    value.apiKey.length > 0 &&
    typeof value.apiSecret === "string" &&
    value.apiSecret.length > 0
    ? { method: "token", apiKey: value.apiKey, apiSecret: value.apiSecret }
    : null;
}

function oauthSecret(value: StoredSecret): EmployeeDirectorySecret | null {
  return typeof value.accessToken === "string" && value.accessToken.length > 0
    ? { method: "oauth_bearer", accessToken: value.accessToken }
    : null;
}

export class EnvironmentEmployeeDirectorySecretProvider implements EmployeeDirectorySecretProvider {
  getSecret(input: {
    organizationId: string;
    reference: string;
    authMethod: EmployeeDirectoryAuthMethod;
  }): EmployeeDirectorySecret {
    const stored = readSecretMap()[input.organizationId]?.[input.reference];
    const secret =
      stored && input.authMethod === "token"
        ? tokenSecret(stored)
        : stored
          ? oauthSecret(stored)
          : null;
    if (!secret) throw new EmployeeDirectoryError("MISSING_CREDENTIALS");
    return secret;
  }
}
