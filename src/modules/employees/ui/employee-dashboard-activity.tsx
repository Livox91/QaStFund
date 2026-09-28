import type {
  EmployeeDashboardActivity,
  EmployeeUpcomingRepayment,
} from "@/modules/employees/domain/employee-dashboard";
import { Badge } from "@/shared/ui/badge";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { EmptyState } from "@/shared/ui/empty-state";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});

export function UpcomingRepaymentList({
  repayments,
}: {
  repayments: ReadonlyArray<EmployeeUpcomingRepayment>;
}) {
  if (repayments.length === 0) {
    return (
      <EmptyState
        className="min-h-64 border-0 p-4"
        description="You have no scheduled loan due dates ahead."
        title="No upcoming repayments"
      />
    );
  }

  return (
    <ul className="space-y-3">
      {repayments.map((repayment) => (
        <li
          key={repayment.loanId}
          className="rounded-xl border border-slate-200 p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">
                {dateFormatter.format(repayment.dueAt)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Payment to {repayment.lenderName}
              </p>
            </div>
            <CurrencyDisplay
              amountMinorUnits={repayment.amountMinorUnits}
              className="text-sm text-slate-950"
              currency={repayment.currency}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EmployeeActivityList({
  activity,
}: {
  activity: ReadonlyArray<EmployeeDashboardActivity>;
}) {
  if (activity.length === 0) {
    return (
      <EmptyState
        className="min-h-64 border-0 p-4"
        description="Your loan and repayment events will appear here."
        title="No recent activity"
      />
    );
  }

  return (
    <ol className="space-y-0">
      {activity.map((event, index) => (
        <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
          {index < activity.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-3 bottom-0 left-[5px] w-px bg-slate-200"
            />
          ) : null}
          <span className="relative mt-1.5 size-3 shrink-0 rounded-full border-2 border-white bg-teal-500 ring-1 ring-teal-200" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-semibold text-slate-950">
                {event.title}
              </p>
              <Badge
                tone={event.participation === "BORROWING" ? "info" : "accent"}
              >
                {event.participation === "BORROWING" ? "Borrowing" : "Lending"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              With {event.counterpartyName} ·{" "}
              {dateTimeFormatter.format(event.occurredAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
