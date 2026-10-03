import Link from "next/link";

import {
  EmployerLoanFilter,
  type EmployerLoanFilter as EmployerLoanFilterType,
  type EmployerLoanListItem,
} from "@/modules/loans/domain/employer-loan";
import { RepaymentProgress } from "@/modules/loans/ui/repayment-progress";
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

const filters: ReadonlyArray<{
  label: string;
  value: EmployerLoanFilterType;
}> = [
  { label: "Active", value: EmployerLoanFilter.ACTIVE },
  { label: "Repaid", value: EmployerLoanFilter.REPAID },
  { label: "Overdue", value: EmployerLoanFilter.OVERDUE },
  { label: "All", value: EmployerLoanFilter.ALL },
];

export function EmployerLoanList({
  activeFilter,
  loans,
  organizationName,
}: {
  activeFilter: EmployerLoanFilterType;
  loans: ReadonlyArray<EmployerLoanListItem>;
  organizationName: string;
}) {
  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <PageHeader
        description={`View agreed terms and repayment status for loans within ${organizationName}.`}
        eyebrow="Employer portal"
        title="Loans"
      />

      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <nav
          aria-label="Filter loans by status"
          className="inline-flex w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
        >
          {filters.map((filter) => {
            const active = filter.value === activeFilter;
            const href =
              filter.value === EmployerLoanFilter.ALL
                ? "/employer/loans"
                : `/employer/loans?status=${filter.value}`;

            return (
              <Link
                key={filter.value}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600",
                  active
                    ? "bg-slate-950 !text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-950",
                )}
                href={href}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>
        <p className="text-sm text-slate-500">
          {loans.length} {loans.length === 1 ? "loan" : "loans"}
        </p>
      </div>

      {loans.length === 0 ? (
        <EmptyState
          className="mt-5"
          description="There are no organization loans matching this status."
          title="No loans found"
        />
      ) : (
        <TableContainer className="mt-5 shadow-sm">
          <Table className="min-w-[1120px]">
            <TableHeader>
              <TableRow className="hover:bg-slate-50/80">
                <TableHead>Borrower</TableHead>
                <TableHead>Lender</TableHead>
                <TableHead>Principal</TableHead>
                <TableHead>Agreed fee</TableHead>
                <TableHead>Start date</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead>Repayment progress</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loans.map((loan) => (
                <TableRow
                  key={loan.id}
                  className="group relative cursor-pointer"
                >
                  <TableCell className="font-semibold text-slate-950">
                    <Link
                      aria-label={`View loan for ${loan.borrowerName}`}
                      className="after:absolute after:inset-0 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
                      href={`/employer/loans/${loan.id}`}
                    >
                      {loan.borrowerName}
                    </Link>
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
                      amountMinorUnits={loan.feeAmountMinorUnits}
                      currency={loan.currency}
                    />
                  </TableCell>
                  <TableCell>{dateFormatter.format(loan.startedAt)}</TableCell>
                  <TableCell>
                    {dateFormatter.format(loan.repaymentDueAt)}
                  </TableCell>
                  <TableCell>
                    <RepaymentProgress basisPoints={loan.progressBasisPoints} />
                  </TableCell>
                  <TableCell>
                    <StatusDisplay status={loan.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <p className="mt-4 text-xs leading-5 text-slate-400">
        This view is read-only. Financial records cannot be changed from the
        employer portal.
      </p>
    </main>
  );
}
