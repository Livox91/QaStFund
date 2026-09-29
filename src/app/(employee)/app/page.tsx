import type { Metadata } from "next";

import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import {
  getEmployeeDashboardForActor,
  getEmployeeIdentityForActor,
} from "@/modules/employees/index.server";
import { EmployeeDashboard } from "@/modules/employees/ui/employee-dashboard";
import { getWalletForActor } from "@/modules/ledger/index.server";
import { getBorrowingCapacityForActor } from "@/modules/policies/index.server";

export const metadata: Metadata = {
  title: "Employee Dashboard",
};

export default async function EmployeeDashboardPage({
  searchParams,
}: PageProps<"/app">) {
  const actor = await requireEmployeePage();
  const query = await searchParams;
  const [dashboard, employee, wallet, borrowingCapacity] = await Promise.all([
    getEmployeeDashboardForActor(actor),
    getEmployeeIdentityForActor(actor),
    getWalletForActor(actor),
    getBorrowingCapacityForActor(actor),
  ]);

  return (
    <EmployeeDashboard
      dashboard={dashboard}
      employee={employee}
      loanCreated={query.loanCreated === "1"}
      organizationName={actor.organizationName}
      wallet={wallet}
      borrowingCapacity={borrowingCapacity}
    />
  );
}
