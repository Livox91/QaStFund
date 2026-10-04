import type { EmployeeDirectoryRepository } from "@/modules/employee-directory/application/ports/employee-directory-repository";
import {
  synchronizeOrganizationEmployees,
  type EmployeeDirectoryAdapterFactory,
} from "@/modules/employee-directory/application/synchronize-employees";
import { EmployeeDirectoryError } from "@/modules/employee-directory/domain/employee-directory";
import type { Clock } from "@/shared/time/clock";
import {
  incrementOperationalCounter,
  operationalFailureAlertThreshold,
  recordOperationalFailure,
  recordOperationalSuccess,
} from "@/infrastructure/observability/operational-signals";

export async function runScheduledEmployeeDirectorySyncs(
  input: {
    intervalMinutes: number;
    staleAfterMinutes: number;
    maxPages?: number;
  },
  repository: EmployeeDirectoryRepository,
  createAdapter: EmployeeDirectoryAdapterFactory,
  clock: Clock,
) {
  const now = clock.now();
  const organizationIds = await repository.listScheduledOrganizations({
    dueBefore: new Date(now.getTime() - input.intervalMinutes * 60_000),
  });
  let succeeded = 0;
  let partial = 0;
  let failed = 0;
  let skipped = 0;
  for (const organizationId of organizationIds) {
    try {
      const result = await synchronizeOrganizationEmployees(
        {
          organizationId,
          trigger: "scheduled",
          staleAfterMs: input.staleAfterMinutes * 60_000,
          maxPages: input.maxPages,
        },
        repository,
        createAdapter,
        clock,
      );
      if (result.status === "partial") partial += 1;
      else succeeded += 1;
      if (result.status === "partial") {
        incrementOperationalCounter("erpnext_sync_failures_total");
        recordOperationalFailure("erpnext", {
          alertThreshold: operationalFailureAlertThreshold(),
          context: { organizationId, result: "partial" },
          occurredAt: clock.now(),
        });
      } else {
        recordOperationalSuccess("erpnext", clock.now());
      }
    } catch (error) {
      if (
        error instanceof EmployeeDirectoryError &&
        error.code === "CONCURRENT_SYNC"
      ) {
        skipped += 1;
      } else {
        failed += 1;
        incrementOperationalCounter("erpnext_sync_failures_total");
        recordOperationalFailure("erpnext", {
          alertThreshold: operationalFailureAlertThreshold(),
          context: { organizationId, result: "failed" },
          occurredAt: clock.now(),
        });
      }
    }
  }
  return {
    considered: organizationIds.length,
    succeeded,
    partial,
    failed,
    skipped,
  };
}
