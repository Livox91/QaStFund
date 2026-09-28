import Link from "next/link";

import type { EmployerLoanDetails as EmployerLoanDetailsView } from "@/modules/loans/domain/employer-loan";
import { RepaymentProgress } from "@/modules/loans/ui/repayment-progress";
import { buttonStyles } from "@/shared/ui/button";
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
  year: "numeric",
});

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-400 uppercase">
        {label}
      </dt>
      <dd className="mt-1.5 text-sm font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

export function EmployerLoanDetails({
  loan,
}: {
  loan: EmployerLoanDetailsView;
}) {
  const durationDays = Math.max(
    1,
    Math.ceil(
      (loan.repaymentDueAt.getTime() - loan.startedAt.getTime()) /
        (24 * 60 * 60 * 1_000),
    ),
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <Link
        className={buttonStyles({
          className: "mb-6 -ml-3",
          size: "sm",
          variant: "ghost",
        })}
        href="/employer/loans"
      >
        <span aria-hidden="true">←</span>
        Back to loans
      </Link>

      <PageHeader
        actions={<StatusDisplay status={loan.status} />}
        description={`${loan.borrowerName} borrowing from ${loan.lenderName}`}
        eyebrow="Loan details"
        title="Original terms and repayment record"
      />

      <div className="mt-8 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800">
        This is a read-only financial record. Employer administrators can review
        its terms and history but cannot modify it.
      </div>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Original agreed terms</CardTitle>
            <CardDescription>
              Terms recorded when the loan was accepted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              <DetailItem
                label="Principal"
                value={
                  <CurrencyDisplay
                    amountMinorUnits={loan.principalAmountMinorUnits}
                    currency={loan.currency}
                  />
                }
              />
              <DetailItem
                label="Agreed return / fee"
                value={
                  <CurrencyDisplay
                    amountMinorUnits={loan.feeAmountMinorUnits}
                    currency={loan.currency}
                  />
                }
              />
              <DetailItem
                label="Total agreed repayment"
                value={
                  <CurrencyDisplay
                    amountMinorUnits={loan.totalAgreedAmountMinorUnits}
                    currency={loan.currency}
                  />
                }
              />
              <DetailItem
                label="Start date"
                value={dateFormatter.format(loan.startedAt)}
              />
              <DetailItem
                label="Due date"
                value={dateFormatter.format(loan.repaymentDueAt)}
              />
              <DetailItem
                label="Agreed duration"
                value={`${durationDays} days`}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Participants</CardTitle>
            <CardDescription>
              Verified members within the same organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
              <DetailItem label="Borrower" value={loan.borrowerName} />
              <DetailItem label="Lender" value={loan.lenderName} />
            </dl>
          </CardContent>
        </Card>
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Repayment progress</CardTitle>
          <CardDescription>
            Progress against principal plus the originally agreed fee.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RepaymentProgress
            basisPoints={loan.progressBasisPoints}
            className="max-w-2xl"
          />
          <dl className="mt-6 grid gap-6 border-t border-slate-100 pt-6 sm:grid-cols-3">
            <DetailItem
              label="Total agreed"
              value={
                <CurrencyDisplay
                  amountMinorUnits={loan.totalAgreedAmountMinorUnits}
                  currency={loan.currency}
                />
              }
            />
            <DetailItem
              label="Repaid"
              value={
                <CurrencyDisplay
                  amountMinorUnits={loan.repaidAmountMinorUnits}
                  currency={loan.currency}
                />
              }
            />
            <DetailItem
              label="Remaining amount"
              value={
                <CurrencyDisplay
                  amountMinorUnits={loan.remainingAmountMinorUnits}
                  className="text-teal-700"
                  currency={loan.currency}
                />
              }
            />
          </dl>
        </CardContent>
      </Card>

      <section className="mt-6 grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-5">
            <CardTitle>Repayment history</CardTitle>
            <CardDescription>
              Completed repayments recorded against this loan.
            </CardDescription>
          </CardHeader>
          {loan.repayments.length > 0 ? (
            <TableContainer className="rounded-none border-x-0 border-b-0 shadow-none">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-slate-50/80">
                    <TableHead>Repayment</TableHead>
                    <TableHead>Paid on</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loan.repayments.map((repayment, index) => (
                    <TableRow key={repayment.id}>
                      <TableCell className="font-semibold text-slate-950">
                        Payment {index + 1}
                      </TableCell>
                      <TableCell>
                        {dateFormatter.format(repayment.paidAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <CurrencyDisplay
                          amountMinorUnits={repayment.amountMinorUnits}
                          currency={repayment.currency}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <EmptyState
              className="min-h-56 rounded-none border-0 border-t"
              description="No completed repayments have been recorded for this loan."
              title="No repayment history"
            />
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>
              Audit events recorded during the loan lifecycle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loan.auditEvents.length > 0 ? (
              <ol className="space-y-0">
                {loan.auditEvents.map((event, index) => (
                  <li
                    key={event.id}
                    className="relative flex gap-4 pb-6 last:pb-0"
                  >
                    {index < loan.auditEvents.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className="absolute top-3 bottom-0 left-[5px] w-px bg-slate-200"
                      />
                    ) : null}
                    <span className="relative mt-1.5 size-3 shrink-0 rounded-full border-2 border-white bg-teal-500 ring-1 ring-teal-200" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-950">
                        {event.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>
                          {dateTimeFormatter.format(event.occurredAt)}
                        </span>
                        {event.actorLabel ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{event.actorLabel}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                className="min-h-56 border-0 p-4"
                description="No audit events have been recorded for this loan."
                title="No timeline available"
              />
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
