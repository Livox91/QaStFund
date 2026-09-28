import type { EmployeeDashboard as EmployeeDashboardView } from "@/modules/employees/domain/employee-dashboard";
import {
  EmployeeActivityList,
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

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function EmployeeDashboard({
  dashboard,
  employeeName,
  organizationName,
}: {
  dashboard: EmployeeDashboardView;
  employeeName: string;
  organizationName: string;
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
              href="/app/borrow"
              title="Browse lending offers"
            >
              Borrow Money
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
        title={`Welcome, ${employeeName}`}
      />
      <p
        id="actions-help"
        className="mt-3 text-xs text-slate-400 sm:text-right"
      >
        Browse offers or create one of your own. Accepting an offer is coming in
        a future release.
      </p>

      <section aria-label="Financial summary" className="mt-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <EmployeeDashboardMetricCard
            helper="Unallocated across active offers"
            label="Available Balance"
            value={
              <CurrencyDisplay
                amountMinorUnits={metrics.availableBalanceMinorUnits}
                currency={dashboard.currency}
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

      <section className="mt-8 grid items-start gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="pb-5">
            <CardTitle>Active borrowing</CardTitle>
            <CardDescription>
              Current loans where you are the borrower.
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
            <CardTitle>Active lending</CardTitle>
            <CardDescription>
              Current loans where you are the lender.
            </CardDescription>
          </CardHeader>
          <EmployeeLoanList
            emptyDescription="Loans funded by you will appear here once active."
            emptyTitle="No active lending"
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
import Link from "next/link";
