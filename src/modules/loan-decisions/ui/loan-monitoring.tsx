import Link from "next/link";

import type { LoanMonitoringRecord } from "@/modules/loan-decisions/application/ports/loan-decision-repository";
import {
  loanDecisionLabels,
  loanDecisionReasonLabels,
  type LoanDecisionClassification,
} from "@/modules/loan-decisions/domain/loan-decision";
import { buttonStyles } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusDisplay } from "@/shared/ui/status-display";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const classifications: LoanDecisionClassification[] = [
  "healthy",
  "due_soon",
  "overdue",
  "default_candidate",
];

export function LoanMonitoring({
  loans,
  organizationName,
}: {
  loans: ReadonlyArray<LoanMonitoringRecord>;
  organizationName: string;
}) {
  const counts = new Map(
    classifications.map((classification) => [
      classification,
      loans.filter((loan) => loan.evaluation.classification === classification)
        .length,
    ]),
  );

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <PageHeader
        description={`Time-based payment monitoring for ${organizationName}. Recommendations never move funds or change loan terms.`}
        eyebrow="Employer portal"
        title="Loan Monitoring"
      />

      <section
        aria-label="Monitoring summary"
        className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {classifications.map((classification) => (
          <Card key={classification}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">
                {loanDecisionLabels[classification]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tracking-tight text-slate-950">
                {counts.get(classification)}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-8">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-slate-950">
            Monitored loans
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Current recommendations from the configured decision provider.
          </p>
        </div>
        {loans.length === 0 ? (
          <EmptyState
            description="Active and recently repaid loans will appear after evaluation."
            title="No loans to monitor"
          />
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {loans.map((loan) => {
              return (
                <li key={loan.loanId}>
                  <Card className="h-full">
                    <CardHeader className="flex-row items-start justify-between gap-4">
                      <div>
                        <CardTitle>{loan.borrowerName}</CardTitle>
                        <p className="mt-1 text-sm text-slate-500">
                          Lending from {loan.lenderName}
                        </p>
                      </div>
                      <StatusDisplay
                        status={
                          loanDecisionLabels[loan.evaluation.classification]
                        }
                      />
                    </CardHeader>
                    <CardContent>
                      <dl className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <dt className="text-slate-500">Amount due</dt>
                          <dd className="mt-1 font-semibold text-slate-950">
                            <CurrencyDisplay
                              amountMinorUnits={
                                loan.outstandingRepaymentMinorUnits
                              }
                              currency={loan.currency}
                            />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Due</dt>
                          <dd className="mt-1 font-semibold text-slate-950">
                            {dateFormatter.format(loan.dueAt)}
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-slate-500">Reason</dt>
                          <dd className="mt-1 font-semibold text-slate-950">
                            {loanDecisionReasonLabels[
                              loan.evaluation.reasonCodes[0]
                            ] ?? "Loan evaluated"}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                        <p className="text-xs text-slate-500">
                          {loan.reviewedAt
                            ? `Reviewed by ${loan.reviewedByName}`
                            : "Not yet reviewed"}
                        </p>
                        <Link
                          className={buttonStyles({
                            size: "sm",
                            variant: "outline",
                          })}
                          href={`/employer/monitoring/${loan.loanId}`}
                        >
                          Review
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
