import type { Metadata } from "next";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployeeDirectoryDashboardForActor } from "@/modules/employee-directory/index.server";
import { getEmployerOverviewForActor } from "@/modules/organizations/index.server";
import { EmployerOverviewDashboard } from "@/modules/organizations/ui/employer-overview-dashboard";
import { listEmployerEmployeesForActor } from "@/modules/policies/index.server";

export const metadata: Metadata = {
  title: "Employer Overview",
};

export default async function EmployerOverviewPage() {
  const actor = await requireEmployerAdminPage();
  const [overview, employees, directory] = await Promise.all([
    getEmployerOverviewForActor(actor),
    listEmployerEmployeesForActor(actor),
    getEmployeeDirectoryDashboardForActor(actor),
  ]);
  const formerEmployees = employees.filter(
    (employee) => employee.employmentStatus !== "ACTIVE",
  );
  const pendingInvitations = employees.filter(
    (employee) =>
      employee.employmentStatus === "ACTIVE" &&
      !employee.accountActivatedAt &&
      employee.invitation?.status === "PENDING",
  );
  const activeEmployees = employees.filter(
    (employee) =>
      employee.employmentStatus === "ACTIVE" &&
      Boolean(employee.accountActivatedAt) &&
      employee.isActive,
  );

  return (
    <EmployerOverviewDashboard
      organizationName={actor.organizationName}
      overview={overview}
      directorySummary={{
        activeEmployees: activeEmployees.length,
        pendingInvitations: pendingInvitations.length,
        formerEmployees: formerEmployees.length,
        connectionStatus:
          directory.integration?.connectionStatus ?? "not configured",
        lastSyncAt: directory.latestRun?.startedAt ?? null,
        lastSyncStatus: directory.latestRun?.status ?? "no sync",
        warning: directory.latestRun?.safeErrorSummary ?? null,
      }}
    />
  );
}
