export type EmployeeDirectoryEligibilityReason =
  | "DIRECTORY_NOT_REQUIRED"
  | "DIRECTORY_TRUSTED"
  | "DIRECTORY_NOT_CONFIGURED"
  | "DIRECTORY_SYNC_INCOMPLETE"
  | "DIRECTORY_SYNC_STALE"
  | "EMPLOYEE_STATUS_NOT_SYNCHRONIZED";

type DirectoryEligibilityInput = Readonly<{
  erpNextEnabled: boolean;
  integration: {
    lastSyncStatus: "SUCCESS" | "PARTIAL" | "FAILED" | "RUNNING" | null;
    lastSuccessfulSyncAt: Date | null;
  } | null;
  employee: {
    employmentStatusSource: "ERPNEXT" | "MANUAL" | null;
    employmentStatusSyncedAt: Date | null;
  };
  now: Date;
  maxAgeMs: number;
}>;

export function evaluateEmployeeDirectoryEligibility(
  input: DirectoryEligibilityInput,
): { trusted: boolean; reason: EmployeeDirectoryEligibilityReason } {
  if (!input.erpNextEnabled) {
    return { trusted: true, reason: "DIRECTORY_NOT_REQUIRED" };
  }
  if (!input.integration) {
    return { trusted: false, reason: "DIRECTORY_NOT_CONFIGURED" };
  }
  if (
    input.integration.lastSyncStatus !== "SUCCESS" ||
    !input.integration.lastSuccessfulSyncAt
  ) {
    return { trusted: false, reason: "DIRECTORY_SYNC_INCOMPLETE" };
  }
  if (
    input.now.getTime() - input.integration.lastSuccessfulSyncAt.getTime() >
    input.maxAgeMs
  ) {
    return { trusted: false, reason: "DIRECTORY_SYNC_STALE" };
  }
  if (
    input.employee.employmentStatusSource !== "ERPNEXT" ||
    !input.employee.employmentStatusSyncedAt ||
    input.employee.employmentStatusSyncedAt <
      input.integration.lastSuccessfulSyncAt
  ) {
    return { trusted: false, reason: "EMPLOYEE_STATUS_NOT_SYNCHRONIZED" };
  }
  return { trusted: true, reason: "DIRECTORY_TRUSTED" };
}
