export type EmployeeDirectoryProvider = "erpnext";
export type EmployeeDirectoryAuthMethod = "token" | "oauth_bearer";
export type EmployeeDirectorySyncTrigger = "manual" | "scheduled";

export type ExternalEmployee = {
  externalId: string;
  employeeCode?: string;
  fullName: string;
  email?: string;
  department?: string;
  designation?: string;
  employmentStatus: string;
  modifiedAt?: string;
};

export type EmployeePage = {
  employees: ExternalEmployee[];
  nextCursor?: string;
};

export type ConnectionStatus =
  | { ok: true; messageCode: "CONNECTION_OK" }
  | { ok: false; messageCode: EmployeeDirectoryErrorCode };

export interface EmployeeDirectoryAdapter {
  testConnection(): Promise<ConnectionStatus>;
  listEmployees(cursor?: string): Promise<EmployeePage>;
  getEmployee(externalEmployeeId: string): Promise<ExternalEmployee | null>;
}

export type EmployeeDirectoryErrorCode =
  | "INVALID_CONFIGURATION"
  | "UNSAFE_URL"
  | "MISSING_CREDENTIALS"
  | "CREDENTIAL_STORAGE_UNAVAILABLE"
  | "AUTHENTICATION_FAILED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "REQUEST_TIMEOUT"
  | "REMOTE_SERVER_ERROR"
  | "REMOTE_RESPONSE_INVALID"
  | "REMOTE_NOT_FOUND"
  | "CONCURRENT_SYNC"
  | "SYNC_LIMIT_EXCEEDED"
  | "PARTIAL_SYNC"
  | "UNEXPECTED_ERROR";

export class EmployeeDirectoryError extends Error {
  constructor(
    readonly code: EmployeeDirectoryErrorCode,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "EmployeeDirectoryError";
  }
}

export type EmployeeDirectorySecret =
  | { method: "token"; apiKey: string; apiSecret: string }
  | { method: "oauth_bearer"; accessToken: string };

export interface EmployeeDirectorySecretProvider {
  getSecret(input: {
    organizationId: string;
    reference: string;
    authMethod: EmployeeDirectoryAuthMethod;
  }): EmployeeDirectorySecret | Promise<EmployeeDirectorySecret>;
}

export type EmployeeDirectoryCredentialInput =
  | { method: "token"; apiKey: string; apiSecret: string }
  | { method: "oauth_bearer"; accessToken: string };

export type EmployeeDirectoryConfig = {
  organizationId: string;
  baseUrl: string;
  apiPath: string;
  apiVersion: string;
  authMethod: EmployeeDirectoryAuthMethod;
  credentialReference: string;
  timeoutMs: number;
};
