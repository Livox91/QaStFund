import type { Metadata } from "next";

import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployeeDashboardForActor } from "@/modules/employees/index.server";
import { EmployeeDashboard } from "@/modules/employees/ui/employee-dashboard";

export const metadata: Metadata = {
  title: "Employee Dashboard",
};

export default async function EmployeeDashboardPage({
  searchParams,
}: PageProps<"/app">) {
  const actor = await requireEmployeePage();
  const query = await searchParams;
  const dashboard = await getEmployeeDashboardForActor(actor);

  return (
    <EmployeeDashboard
      dashboard={dashboard}
      employeeName={actor.name}
      loanCreated={query.loanCreated === "1"}
      organizationName={actor.organizationName}
    />
  );
}
