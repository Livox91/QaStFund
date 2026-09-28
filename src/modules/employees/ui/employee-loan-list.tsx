import type { EmployeeDashboardLoan } from "@/modules/employees/domain/employee-dashboard";
import { RepaymentProgress } from "@/modules/loans/ui/repayment-progress";
import { buttonStyles } from "@/shared/ui/button";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { EmptyState } from "@/shared/ui/empty-state";
import { StatusDisplay } from "@/shared/ui/status-display";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function EmployeeLoanList({
  emptyDescription,
  emptyTitle,
  loans,
}: {
  emptyDescription: string;
  emptyTitle: string;
  loans: ReadonlyArray<EmployeeDashboardLoan>;
}) {
  if (loans.length === 0) {
    return (
      <EmptyState
        className="min-h-64 rounded-none border-0 border-t"
        description={emptyDescription}
        title={emptyTitle}
      />
    );
  }

  return (
    <ul className="divide-y divide-slate-100 border-t border-slate-100">
      {loans.map((loan) => (
        <li key={loan.id} className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-950">
                {loan.participation === "BORROWING" ? "From" : "To"}{" "}
                {loan.counterpartyName}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Due {dateFormatter.format(loan.repaymentDueAt)}
              </p>
            </div>
            <StatusDisplay status={loan.status} />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-slate-400">Original principal</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-950">
                <CurrencyDisplay
                  amountMinorUnits={loan.principalAmountMinorUnits}
                  currency={loan.currency}
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Outstanding principal</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-950">
                <CurrencyDisplay
                  amountMinorUnits={loan.outstandingPrincipalMinorUnits}
                  currency={loan.currency}
                />
              </dd>
            </div>
          </dl>

          <RepaymentProgress
            basisPoints={loan.progressBasisPoints}
            className="mt-5"
          />
          {loan.participation === "BORROWING" ? (
            <Link
              className={buttonStyles({
                className: "mt-5",
                size: "sm",
                variant: "outline",
              })}
              href={`/app/loans/${loan.id}`}
            >
              View and repay
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
import Link from "next/link";
