import type {
  EmployerOverview,
  EmployerOverviewAttentionLoan,
  EmployerOverviewLoan,
} from "@/modules/organizations/domain/employer-overview";
import { Badge } from "@/shared/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusDisplay } from "@/shared/ui/status-display";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { cn } from "@/shared/utils/class-names";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});

function MetricCard({
  emphasis = "default",
  helper,
  label,
  value,
}: {
  emphasis?: "default" | "warning";
  helper: string;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        emphasis === "warning" && "border-amber-200",
      )}
    >
      <CardContent className="p-5">
        <div
          aria-hidden="true"
          className={cn(
            "absolute top-0 right-0 h-full w-1",
            emphasis === "warning" ? "bg-amber-400" : "bg-teal-500",
          )}
        />
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
          {value}
        </p>
        <p className="mt-1.5 text-xs leading-5 text-slate-400">{helper}</p>
      </CardContent>
    </Card>
  );
}

function RecentLoanTable({
  loans,
}: {
  loans: ReadonlyArray<EmployerOverviewLoan>;
}) {
  if (loans.length === 0) {
    return (
      <EmptyState
        className="min-h-72 rounded-none border-0 border-t"
        description="Loan activity for this organization will appear here."
        title="No loan activity yet"
      />
    );
  }

  return (
    <TableContainer className="rounded-none border-x-0 border-b-0 shadow-none">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-slate-50/80">
            <TableHead>Borrower</TableHead>
            <TableHead>Lender</TableHead>
            <TableHead>Principal</TableHead>
            <TableHead>Outstanding</TableHead>
            <TableHead>Repayment date</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loans.map((loan) => (
            <TableRow key={loan.id}>
              <TableCell className="font-semibold text-slate-950">
                {loan.borrowerName}
              </TableCell>
              <TableCell>{loan.lenderName}</TableCell>
              <TableCell>
                <CurrencyDisplay
                  amountMinorUnits={loan.principalAmountMinorUnits}
                  currency={loan.currency}
                />
              </TableCell>
              <TableCell>
                <CurrencyDisplay
                  amountMinorUnits={loan.outstandingPrincipalMinorUnits}
                  currency={loan.currency}
                />
              </TableCell>
              <TableCell>{dateFormatter.format(loan.repaymentDueAt)}</TableCell>
              <TableCell>
                <StatusDisplay status={loan.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function AttentionLoan({ loan }: { loan: EmployerOverviewAttentionLoan }) {
  return (
    <li className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">
            {loan.borrowerName}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Lent by {loan.lenderName}
          </p>
        </div>
        <Badge tone={loan.attention.kind === "OVERDUE" ? "danger" : "warning"}>
          {loan.attention.label}
        </Badge>
      </div>
      <div className="mt-4 flex items-end justify-between gap-4 border-t border-slate-100 pt-3">
        <div>
          <p className="text-xs text-slate-400">Outstanding</p>
          <CurrencyDisplay
            amountMinorUnits={loan.outstandingPrincipalMinorUnits}
            className="mt-0.5 block text-sm text-slate-950"
            currency={loan.currency}
          />
        </div>
        <StatusDisplay status={loan.status} />
      </div>
    </li>
  );
}

export function EmployerOverviewDashboard({
  organizationName,
  overview,
}: {
  organizationName: string;
  overview: EmployerOverview;
}) {
  const { metrics } = overview;

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <PageHeader
        actions={
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-sm">
            <span className="size-2 rounded-full bg-emerald-500" />
            Live data · {timestampFormatter.format(overview.generatedAt)}
          </div>
        }
        description={`Monitor participation and loan health across ${organizationName}.`}
        eyebrow="Employer portal"
        title="Overview"
      />

      <section aria-label="Organization metrics" className="mt-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            helper="Active employee memberships"
            label="Total employees"
            value={metrics.totalEmployees.toLocaleString("en-US")}
          />
          <MetricCard
            helper="Active offers or outstanding loans"
            label="Currently lending"
            value={metrics.employeesCurrentlyLending.toLocaleString("en-US")}
          />
          <MetricCard
            helper="Employees with outstanding loans"
            label="Currently borrowing"
            value={metrics.employeesCurrentlyBorrowing.toLocaleString("en-US")}
          />
          <MetricCard
            helper="Available across active offers"
            label="Available liquidity"
            value={
              <CurrencyDisplay
                amountMinorUnits={metrics.availableLiquidityMinorUnits}
                currency={overview.currency}
              />
            }
          />
          <MetricCard
            helper="Across active and overdue loans"
            label="Outstanding principal"
            value={
              <CurrencyDisplay
                amountMinorUnits={metrics.outstandingPrincipalMinorUnits}
                currency={overview.currency}
              />
            }
          />
          <MetricCard
            helper="Active loans due in the next 7 days"
            label="Repayments due"
            value={metrics.repaymentsDue.toLocaleString("en-US")}
          />
          <MetricCard
            emphasis={metrics.overdueLoans > 0 ? "warning" : "default"}
            helper="Loans past their repayment date"
            label="Overdue loans"
            value={metrics.overdueLoans.toLocaleString("en-US")}
          />
        </div>
      </section>

      <section className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-5">
            <CardTitle>Recent loan activity</CardTitle>
            <CardDescription>
              The latest loan records updated within this organization.
            </CardDescription>
          </CardHeader>
          <RecentLoanTable loans={overview.recentLoanActivity} />
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Loans requiring attention</CardTitle>
                <CardDescription>
                  Overdue or due within the next 3 days.
                </CardDescription>
              </div>
              <Badge
                tone={
                  overview.loansRequiringAttention.length > 0
                    ? "warning"
                    : "success"
                }
              >
                {overview.loansRequiringAttention.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {overview.loansRequiringAttention.length > 0 ? (
              <ul className="space-y-3">
                {overview.loansRequiringAttention.map((loan) => (
                  <AttentionLoan key={loan.id} loan={loan} />
                ))}
              </ul>
            ) : (
              <EmptyState
                className="min-h-64 border-0 p-4"
                description="No overdue loans or repayments due within three days."
                title="Nothing needs attention"
              />
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
