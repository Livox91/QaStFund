import Link from "next/link";

import { executeEmployerActionAction } from "@/app/(employer)/employer/monitoring/[loanId]/actions";
import type {
  EmployerActionAttempt,
  EmployerActionType,
} from "@/modules/employer-actions/domain/employer-action";
import {
  employerActionLabels,
  employerActionMessageLabels,
} from "@/modules/employer-actions/domain/employer-action";
import type { LoanMonitoringRecord } from "@/modules/loan-decisions/application/ports/loan-decision-repository";
import {
  calculateDaysOverdue,
  loanDecisionActionLabels,
  loanDecisionLabels,
  loanDecisionReasonLabels,
} from "@/modules/loan-decisions/domain/loan-decision";
import { Button, buttonStyles } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusDisplay } from "@/shared/ui/status-display";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-400 uppercase">
        {label}
      </dt>
      <dd className="mt-1.5 text-sm font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

export function LoanReview({
  actionError,
  actionRecorded,
  actions,
  loan,
}: {
  actionError: boolean;
  actionRecorded: boolean;
  actions: ReadonlyArray<EmployerActionAttempt>;
  loan: LoanMonitoringRecord;
}) {
  const daysOverdue = calculateDaysOverdue(
    loan.dueAt,
    loan.evaluation.evaluatedAt,
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <Link
        className={buttonStyles({
          className: "mb-6 -ml-3",
          size: "sm",
          variant: "ghost",
        })}
        href="/employer/monitoring"
      >
        <span aria-hidden="true">←</span>
        Back to monitoring
      </Link>
      <PageHeader
        actions={
          <StatusDisplay
            status={loanDecisionLabels[loan.evaluation.classification]}
          />
        }
        description="Review the recommendation without changing the financial loan state."
        eyebrow="Employer portal"
        title="Loan Review"
      />

      {actionRecorded ? (
        <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Employer action recorded. External contact and HR actions in this
          milestone are simulations only.
        </p>
      ) : null}
      {actionError ? (
        <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          The action could not be recorded. No external or financial action was
          performed.
        </p>
      ) : null}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Loan and risk details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Borrower" value={loan.borrowerName} />
            <Detail label="Lender" value={loan.lenderName} />
            <Detail
              label="Principal"
              value={
                <CurrencyDisplay
                  amountMinorUnits={loan.principalAmountMinorUnits}
                  currency={loan.currency}
                />
              }
            />
            <Detail
              label="Amount due"
              value={
                <CurrencyDisplay
                  amountMinorUnits={loan.outstandingRepaymentMinorUnits}
                  currency={loan.currency}
                />
              }
            />
            <Detail label="Due date" value={dateFormatter.format(loan.dueAt)} />
            <Detail label="Days overdue" value={daysOverdue} />
            <Detail
              label="On-chain financial status"
              value={loan.financialStatus}
            />
            <Detail
              label="Risk status"
              value={loanDecisionLabels[loan.evaluation.classification]}
            />
            <Detail
              label="Reason"
              value={loan.evaluation.reasonCodes
                .map((reason) => loanDecisionReasonLabels[reason])
                .join(" · ")}
            />
          </dl>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recommended Action</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg font-semibold text-slate-950">
            {loanDecisionActionLabels[loan.evaluation.recommendedAction]}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            This recommendation cannot deduct salary, move funds, apply a
            penalty, or default the loan.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {!loan.reviewedAt ? (
              <ActionForm action="mark_reviewed" loanId={loan.loanId} />
            ) : (
              <>
                <ActionForm
                  action="request_employee_contact"
                  loanId={loan.loanId}
                />
                <ActionForm
                  action="request_hr_follow_up"
                  loanId={loan.loanId}
                />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Previous Reviews</CardTitle>
          </CardHeader>
          <CardContent>
            {loan.reviews.length === 0 ? (
              <p className="text-sm text-slate-500">
                No review has been recorded.
              </p>
            ) : (
              <ul className="space-y-3">
                {loan.reviews.map((review) => (
                  <li
                    className="rounded-xl border border-slate-200 p-3 text-sm"
                    key={review.id}
                  >
                    <p className="font-semibold text-slate-950">
                      Reviewed by {review.reviewedByName}
                    </p>
                    <p className="mt-1 text-slate-500">
                      {loanDecisionLabels[review.classification]} ·{" "}
                      {dateTimeFormatter.format(review.reviewedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employer Action Attempts</CardTitle>
          </CardHeader>
          <CardContent>
            {actions.length === 0 ? (
              <p className="text-sm text-slate-500">
                No employer action has been requested.
              </p>
            ) : (
              <ul className="space-y-3">
                {actions.map((action) => (
                  <li
                    className="rounded-xl border border-slate-200 p-3 text-sm"
                    key={action.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-slate-950">
                        {employerActionLabels[action.action]}
                      </p>
                      <StatusDisplay status={action.status} />
                    </div>
                    <p className="mt-1 text-slate-500">
                      {employerActionMessageLabels[action.messageCode] ??
                        "Action result recorded."}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      Requested by {action.requestedByName} ·{" "}
                      {dateTimeFormatter.format(action.requestedAt)} · Mock
                      provider
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function ActionForm({
  action,
  loanId,
}: {
  action: EmployerActionType;
  loanId: string;
}) {
  return (
    <form action={executeEmployerActionAction}>
      <input name="loanId" type="hidden" value={loanId} />
      <input name="action" type="hidden" value={action} />
      <input name="idempotencyKey" type="hidden" value={crypto.randomUUID()} />
      <Button
        type="submit"
        variant={action === "mark_reviewed" ? "primary" : "outline"}
      >
        {action === "mark_reviewed"
          ? "Mark Reviewed"
          : action === "request_employee_contact"
            ? "Simulate Contact Request"
            : "Simulate HR Follow-up"}
      </Button>
    </form>
  );
}
