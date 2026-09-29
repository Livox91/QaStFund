import type { Metadata } from "next";

import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployeeDashboardForActor } from "@/modules/employees/index.server";
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
  const [dashboard, wallet, borrowingCapacity] = await Promise.all([
    getEmployeeDashboardForActor(actor),
    getWalletForActor(actor),
    getBorrowingCapacityForActor(actor),
  ]);

  return (
    <EmployeeDashboard
      dashboard={dashboard}
      employeeName={actor.name}
      loanCreated={query.loanCreated === "1"}
      organizationName={actor.organizationName}
      wallet={wallet}
      borrowingCapacity={borrowingCapacity}
    />
  );
}
