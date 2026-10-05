import type { Metadata } from "next";

import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { getArcWalletForActor } from "@/modules/arc-wallet/index.server";
import { getEmployeeOnboardingState } from "@/modules/employees/domain/employee-onboarding";
import {
  getEmployeeDashboardForActor,
  getEmployeeIdentityForActor,
} from "@/modules/employees/index.server";
import { EmployeeDashboard } from "@/modules/employees/ui/employee-dashboard";
import { getWalletForActor } from "@/modules/ledger/index.server";
import { getBorrowingCapacityForActor } from "@/modules/policies/index.server";
import { getLendingMarketplaceForActor } from "@/modules/lending/index.server";
import { LendingMarketplaceSort } from "@/modules/lending/domain/lending-offer";

export const metadata: Metadata = {
  title: "Employee Dashboard",
};

export default async function EmployeeDashboardPage({
  searchParams,
}: PageProps<"/app">) {
  const actor = await requireEmployeePage();
  const query = await searchParams;
  const [
    dashboard,
    employee,
    wallet,
    borrowingCapacity,
    arcWallet,
    marketplace,
  ] = await Promise.all([
    getEmployeeDashboardForActor(actor),
    getEmployeeIdentityForActor(actor),
    getWalletForActor(actor),
    getBorrowingCapacityForActor(actor),
    getArcWalletForActor(actor),
    getLendingMarketplaceForActor(actor, {
      sort: LendingMarketplaceSort.LOWEST_FEE,
    }),
  ]);
  const onboarding = getEmployeeOnboardingState({
    employee,
    wallet: arcWallet,
    capacity: borrowingCapacity,
  });

  return (
    <EmployeeDashboard
      dashboard={dashboard}
      employee={employee}
      loanCreated={query.loanCreated === "1"}
      organizationName={actor.organizationName}
      wallet={wallet}
      borrowingCapacity={borrowingCapacity}
      onboarding={onboarding}
      availableOffers={marketplace.offers.slice(0, 3)}
    />
  );
}
