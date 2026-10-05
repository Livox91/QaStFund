import type { EmployeeDirectoryErrorCode } from "@/modules/employee-directory/domain/employee-directory";

const summaries: Record<EmployeeDirectoryErrorCode, string> = {
  INVALID_CONFIGURATION: "The integration configuration is invalid.",
  UNSAFE_URL:
    "The configured ERPNext address did not pass security validation.",
  MISSING_CREDENTIALS:
    "The configured server-side credential could not be found.",
  CREDENTIAL_STORAGE_UNAVAILABLE:
    "Secure ERPNext credential storage is not configured on the server.",
  AUTHENTICATION_FAILED: "ERPNext rejected the integration credentials.",
  PERMISSION_DENIED:
    "The ERPNext integration user lacks Employee read permission.",
  RATE_LIMITED: "ERPNext temporarily rate-limited synchronization.",
  REQUEST_TIMEOUT: "ERPNext did not respond before the configured timeout.",
  REMOTE_SERVER_ERROR: "ERPNext returned a temporary server error.",
  REMOTE_RESPONSE_INVALID: "ERPNext returned an unsupported response.",
  REMOTE_NOT_FOUND: "The ERPNext Employee resource was not found.",
  CONCURRENT_SYNC: "Another synchronization is already running.",
  SYNC_LIMIT_EXCEEDED:
    "ERPNext returned more employee pages than the configured safety limit.",
  PARTIAL_SYNC: "Some records were synchronized; others require review.",
  UNEXPECTED_ERROR: "Synchronization failed unexpectedly.",
};

export function safeSyncErrorSummary(code: EmployeeDirectoryErrorCode): string {
  return summaries[code];
}

export function isPermanentScheduledSyncError(
  code: EmployeeDirectoryErrorCode,
): boolean {
  return [
    "INVALID_CONFIGURATION",
    "UNSAFE_URL",
    "MISSING_CREDENTIALS",
    "CREDENTIAL_STORAGE_UNAVAILABLE",
    "AUTHENTICATION_FAILED",
    "PERMISSION_DENIED",
    "REMOTE_NOT_FOUND",
    "SYNC_LIMIT_EXCEEDED",
  ].includes(code);
}
