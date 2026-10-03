import "server-only";

import { validateEnvironment } from "@/infrastructure/config/environment";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { configureEmployeeDirectory } from "@/modules/employee-directory/application/configure-employee-directory";
import { runScheduledEmployeeDirectorySyncs } from "@/modules/employee-directory/application/run-scheduled-syncs";
import { synchronizeEmployees } from "@/modules/employee-directory/application/synchronize-employees";
import { testEmployeeDirectoryConnection } from "@/modules/employee-directory/application/test-employee-directory-connection";
import { ErpNextEmployeeDirectoryAdapter } from "@/modules/employee-directory/infrastructure/erpnext-employee-directory-adapter";
import { EnvironmentEmployeeDirectorySecretProvider } from "@/modules/employee-directory/infrastructure/environment-secret-provider";
import { prismaEmployeeDirectoryRepository } from "@/modules/employee-directory/infrastructure/prisma-employee-directory-repository";
import { systemClock } from "@/shared/time/clock";

const secretProvider = new EnvironmentEmployeeDirectorySecretProvider();

function adapterFactory(
  config: ConstructorParameters<typeof ErpNextEmployeeDirectoryAdapter>[0],
) {
  return new ErpNextEmployeeDirectoryAdapter(config, secretProvider, {
    allowLocalDevelopment: process.env.ERP_NEXT_ALLOW_LOCAL_HTTP === "true",
  });
}

export function configureEmployeeDirectoryForActor(
  actor: AuthenticatedActor | null,
  input: Parameters<typeof configureEmployeeDirectory>[1],
) {
  return configureEmployeeDirectory(
    actor,
    input,
    prismaEmployeeDirectoryRepository,
    {
      allowLocalDevelopment: process.env.ERP_NEXT_ALLOW_LOCAL_HTTP === "true",
    },
  );
}

export function testEmployeeDirectoryConnectionForActor(
  actor: AuthenticatedActor | null,
) {
  return testEmployeeDirectoryConnection(
    actor,
    prismaEmployeeDirectoryRepository,
    adapterFactory,
    systemClock,
  );
}

export function synchronizeEmployeesForActor(actor: AuthenticatedActor | null) {
  const environment = validateEnvironment();
  return synchronizeEmployees(
    actor,
    prismaEmployeeDirectoryRepository,
    adapterFactory,
    systemClock,
    {
      staleAfterMs: environment.ERP_NEXT_SYNC_STALE_AFTER_MINUTES * 60_000,
    },
  );
}

export async function getEmployeeDirectoryDashboardForActor(
  actor: AuthenticatedActor | null,
) {
  const employer = requireEmployerAdmin(actor);
  const dashboard = await prismaEmployeeDirectoryRepository.getDashboard(
    employer.organizationId,
  );
  const environment = validateEnvironment();
  const lastAttemptedAt = dashboard.latestRun?.startedAt ?? null;
  const calculatedNext = lastAttemptedAt
    ? new Date(
        lastAttemptedAt.getTime() +
          environment.ERP_NEXT_SYNC_INTERVAL_MINUTES * 60_000,
      )
    : systemClock.now();
  return {
    ...dashboard,
    schedule: {
      enabled: environment.ERP_NEXT_SYNC_ENABLED,
      intervalMinutes: environment.ERP_NEXT_SYNC_INTERVAL_MINUTES,
      nextScheduledSyncAt:
        environment.ERP_NEXT_SYNC_ENABLED &&
        dashboard.configured &&
        !dashboard.integration?.scheduledSyncPausedAt
          ? calculatedNext
          : null,
      pausedCode: dashboard.integration?.schedulePauseCode ?? null,
    },
  };
}

export function runConfiguredScheduledEmployeeDirectorySyncs() {
  const environment = validateEnvironment();
  if (!environment.ERP_NEXT_SYNC_ENABLED) {
    return Promise.resolve({
      considered: 0,
      succeeded: 0,
      partial: 0,
      failed: 0,
      skipped: 0,
    });
  }
  return runScheduledEmployeeDirectorySyncs(
    {
      intervalMinutes: environment.ERP_NEXT_SYNC_INTERVAL_MINUTES,
      staleAfterMinutes: environment.ERP_NEXT_SYNC_STALE_AFTER_MINUTES,
    },
    prismaEmployeeDirectoryRepository,
    adapterFactory,
    systemClock,
  );
}
