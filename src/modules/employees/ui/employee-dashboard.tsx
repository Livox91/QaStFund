import Link from "next/link";

import { ArcWalletPanel } from "@/modules/arc-wallet/ui/arc-wallet-panel";
import type { EmployeeDashboard as EmployeeDashboardView } from "@/modules/employees/domain/employee-dashboard";
import type { Employee } from "@/modules/employees/domain/employee";
import {
  EmployeeActivityList,
  PendingTransactionList,
  UpcomingRepaymentList,
} from "@/modules/employees/ui/employee-dashboard-activity";
import { EmployeeDashboardMetricCard } from "@/modules/employees/ui/employee-dashboard-metric-card";
import { EmployeeLoanList } from "@/modules/employees/ui/employee-loan-list";
import { buttonStyles } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { PageHeader } from "@/shared/ui/page-header";
import type { Wallet } from "@/modules/ledger/domain/ledger";
import { WalletCard } from "@/modules/ledger/ui/wallet-card";
import type { BorrowingCapacity } from "@/modules/policies/domain/lending-policy";
import type { EmployeeOnboardingState } from "@/modules/employees/domain/employee-onboarding";
import type { MarketplaceLendingOffer } from "@/modules/lending/domain/lending-offer";
import { formatBasisPointsAsPercent } from "@/modules/lending/domain/lending-offer";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function EmployeeDashboard({
  dashboard,
  employee,
  loanCreated = false,
  organizationName,
  wallet,
  borrowingCapacity,
  onboarding,
  availableOffers,
}: {
  dashboard: EmployeeDashboardView;
  employee: Employee;
  loanCreated?: boolean;
  organizationName: string;
  wallet: Wallet;
  borrowingCapacity: BorrowingCapacity;
  onboarding: EmployeeOnboardingState;
  availableOffers: ReadonlyArray<MarketplaceLendingOffer>;
}) {
  const { metrics } = dashboard;

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <PageHeader
        actions={
          <div
            aria-describedby="actions-help"
            className="flex flex-wrap items-center gap-3"
          >
            <Link
              className={buttonStyles({ size: "lg" })}
              href={onboarding.readyToUse ? "/app/borrow" : "/app/onboarding"}
              title={
                onboarding.readyToUse
                  ? "Browse lending offers"
                  : "Complete setup"
              }
            >
              {onboarding.readyToUse ? "Lending Marketplace" : "Complete setup"}
            </Link>
            <Link
              className={buttonStyles({ size: "lg", variant: "secondary" })}
              href="/app/lending#new-offer"
              title="Create a lending offer"
            >
              Lend Money
            </Link>
          </div>
        }
        description={`A clear view of your lending and borrowing activity within ${organizationName}.`}
        eyebrow="Employee portal"
        title={`Welcome, ${employee.name}`}
      />
      {loanCreated ? (
        <p
          className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          role="status"
        >
          Funds received. Your loan is now active and its repayment date is set.
        </p>
      ) : null}
      {!onboarding.readyToUse ? (
        <p
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
        >
          Lending setup is not complete. You can still view historical activity,
          but wallet or eligibility setup is required for new transactions.
        </p>
      ) : null}
      <p
        id="actions-help"
        className="mt-3 text-xs text-slate-400 sm:text-right"
      >
        Browse offers or create one of your own.
      </p>

      <section aria-label="Financial summary" className="mt-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <EmployeeDashboardMetricCard
            helper="Unallocated across active offers"
            label="Available Balance"
            value={
              <CurrencyDisplay
                amountMinorUnits={metrics.availableBalanceMinorUnits}
                currency="USDC"
              />
            }
          />
          <EmployeeDashboardMetricCard
            helper="Outstanding principal lent"
            label="Amount Lent"
            value={
              <CurrencyDisplay
                amountMinorUnits={metrics.amountLentMinorUnits}
                currency={dashboard.currency}
              />
            }
          />
          <EmployeeDashboardMetricCard
            helper="Outstanding principal borrowed"
            label="Amount Borrowed"
            value={
              <CurrencyDisplay
                amountMinorUnits={metrics.amountBorrowedMinorUnits}
                currency={dashboard.currency}
              />
            }
          />
          <EmployeeDashboardMetricCard
            helper={
              metrics.nextPayment
                ? `Due ${dateFormatter.format(metrics.nextPayment.dueAt)}`
                : "Nothing scheduled"
            }
            label="Next Payment"
            value={
              metrics.nextPayment ? (
                <CurrencyDisplay
                  amountMinorUnits={metrics.nextPayment.amountMinorUnits}
                  currency={metrics.nextPayment.currency}
                />
              ) : (
                "—"
              )
            }
          />
          <EmployeeDashboardMetricCard
            helper="Agreed fees on repaid loans"
            label="Total Earnings"
            value={
              <CurrencyDisplay
                amountMinorUnits={metrics.totalEarningsMinorUnits}
                currency={dashboard.currency}
              />
            }
          />
        </div>
      </section>

      <Card className="mt-6">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Available offers</CardTitle>
            <CardDescription>
              Funded offers you are currently eligible to review.
            </CardDescription>
          </div>
          <Link
            className={buttonStyles({ size: "sm", variant: "outline" })}
            href="/app/borrow"
          >
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {availableOffers.length === 0 ? (
            <p className="text-sm text-slate-500">
              No eligible offers are available right now.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {availableOffers.map((offer) => (
                <li
                  className="rounded-xl border border-slate-200 p-4"
                  key={offer.id}
                >
                  <p className="font-semibold text-slate-950">
                    {offer.lender.name}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    <CurrencyDisplay
                      amountMinorUnits={offer.availableAmountMinorUnits}
                      currency={offer.currency}
                    />{" "}
                    · {formatBasisPointsAsPercent(offer.feeRateBasisPoints)} ·{" "}
                    {offer.durationDays} days
                  </p>
                  <Link
                    className="mt-3 inline-block text-sm font-semibold text-teal-700"
                    href={`/app/borrow/${offer.id}`}
                  >
                    Review terms
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ArcWalletPanel employee={employee} />

      <WalletCard wallet={wallet} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Pending transactions</CardTitle>
          <CardDescription>
            Submitted operations remain pending until receipt verification or
            blockchain reconciliation records the final state.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PendingTransactionList
            transactions={dashboard.pendingTransactions}
          />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Borrowing Capacity</CardTitle>
          <CardDescription>
            {!borrowingCapacity.lendingEnabled ||
            !borrowingCapacity.borrowingEnabled
              ? "Borrowing is currently unavailable for your organization."
              : !borrowingCapacity.employeeCanBorrow
                ? "Your borrowing access is currently disabled."
                : "Your current capacity under the organization lending policy."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CapacityItem label="Available capacity">
            <CurrencyDisplay
              amountMinorUnits={
                borrowingCapacity.remainingDebtCapacityMinorUnits
              }
              currency="USDC"
            />
          </CapacityItem>
          <CapacityItem label="Outstanding">
            <>
              <CurrencyDisplay
                amountMinorUnits={borrowingCapacity.outstandingDebtMinorUnits}
                currency="USDC"
              />{" "}
              /{" "}
              <CurrencyDisplay
                amountMinorUnits={
                  borrowingCapacity.maxOutstandingDebtMinorUnits
                }
                currency="USDC"
              />
            </>
          </CapacityItem>
          <CapacityItem label="Active loans">
            {borrowingCapacity.activeLoans} / {borrowingCapacity.maxActiveLoans}
          </CapacityItem>
          <CapacityItem label="Maximum single loan">
            <CurrencyDisplay
              amountMinorUnits={borrowingCapacity.maxLoanAmountMinorUnits}
              currency="USDC"
            />
          </CapacityItem>
        </CardContent>
      </Card>

      <section className="mt-8 grid items-start gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="pb-5">
            <CardTitle>My Loans</CardTitle>
            <CardDescription>
              Active and repaid loans where you are the borrower.
            </CardDescription>
          </CardHeader>
          <EmployeeLoanList
            emptyDescription="Loans you borrow will appear here once active."
            emptyTitle="No active borrowing"
            loans={dashboard.activeBorrowing}
          />
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-5">
            <CardTitle>Funded Loans</CardTitle>
            <CardDescription>
              Active and repaid loans where you are the lender.
            </CardDescription>
          </CardHeader>
          <EmployeeLoanList
            emptyDescription="Loans funded by you will appear here once active."
            emptyTitle="No funded loans"
            loans={dashboard.activeLending}
          />
        </Card>
      </section>

      <section className="mt-6 grid items-start gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming repayments</CardTitle>
            <CardDescription>
              Remaining agreed amounts by contractual due date.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UpcomingRepaymentList repayments={dashboard.upcomingRepayments} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              The latest events from loans you participate in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmployeeActivityList activity={dashboard.recentActivity} />
          </CardContent>
        </Card>
      </section>

      <p className="mt-6 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-400">
        Dashboard values are read-only and based on recorded offers, loans, and
        completed repayments.
      </p>
    </main>
  );
}

function CapacityItem({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="mt-2 font-semibold text-slate-950">{children}</div>
    </div>
  );
}
