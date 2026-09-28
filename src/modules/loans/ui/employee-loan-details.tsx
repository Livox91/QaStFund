import Link from "next/link";

import { RepaymentForm } from "@/app/(employee)/app/loans/[loanId]/repayment-form";
import { formatBasisPointsAsPercent } from "@/modules/lending/domain/lending-offer";
import type { EmployeeBorrowedLoanDetails as EmployeeLoanDetailsView } from "@/modules/loans/domain/employee-loan";
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

function moneyInputValue(amountMinorUnits: bigint): string {
  const whole = amountMinorUnits / 100n;
  const fraction = (amountMinorUnits % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

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

export function EmployeeLoanDetails({
  loan,
  repaymentRecorded,
}: {
  loan: EmployeeLoanDetailsView;
  repaymentRecorded: boolean;
}) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <Link
        className={buttonStyles({
          className: "mb-6 -ml-3",
          size: "sm",
          variant: "ghost",
        })}
        href="/app"
      >
        <span aria-hidden="true">←</span>
        Back to dashboard
      </Link>

      <PageHeader
        actions={<StatusDisplay status={loan.status} />}
        description={`Borrowed from ${loan.lenderName}. Repayments use your internal mock balance.`}
        eyebrow="Borrowed loan"
        title="Loan details"
      />

      {repaymentRecorded ? (
        <p
          className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          role="status"
        >
          Repayment recorded. Balances and repayment progress are updated.
        </p>
      ) : null}

      <section className="mt-8 grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Agreed terms</CardTitle>
            <CardDescription>
              Terms snapshotted when the loan was created.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
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
                label="Agreed fee"
                value={
                  <CurrencyDisplay
                    amountMinorUnits={loan.feeAmountMinorUnits}
                    currency={loan.currency}
                  />
                }
              />
              <Detail
                label="Fee rate"
                value={formatBasisPointsAsPercent(loan.feeRateBasisPoints)}
              />
              <Detail label="Duration" value={`${loan.durationDays} days`} />
              <Detail
                label="Started"
                value={dateFormatter.format(loan.startedAt)}
              />
              <Detail
                label="Due"
                value={dateFormatter.format(loan.repaymentDueAt)}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Repayment progress</CardTitle>
            <CardDescription>
              Progress against principal plus the agreed fee.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RepaymentProgress basisPoints={loan.progressBasisPoints} />
            <dl className="mt-6 grid grid-cols-2 gap-5">
              <Detail
                label="Repaid"
                value={
                  <CurrencyDisplay
                    amountMinorUnits={loan.repaidAmountMinorUnits}
                    currency={loan.currency}
                  />
                }
              />
              <Detail
                label="Remaining"
                value={
                  <CurrencyDisplay
                    amountMinorUnits={loan.remainingAmountMinorUnits}
                    className="text-teal-700"
                    currency={loan.currency}
                  />
                }
              />
              <Detail
                label="Outstanding principal"
                value={
                  <CurrencyDisplay
                    amountMinorUnits={loan.outstandingPrincipalMinorUnits}
                    currency={loan.currency}
                  />
                }
              />
              <Detail
                label="Total agreed"
                value={
                  <CurrencyDisplay
                    amountMinorUnits={loan.totalAgreedAmountMinorUnits}
                    currency={loan.currency}
                  />
                }
              />
            </dl>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid items-start gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader>
            <CardTitle>
              {loan.canRepay ? "Repay loan" : "Repayment closed"}
            </CardTitle>
            <CardDescription>
              {loan.canRepay
                ? "Make a partial payment or settle the full remaining amount."
                : "This loan does not accept additional repayments."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loan.canRepay ? (
              <>
                <RepaymentForm
                  currency={loan.currency}
                  fullAmount={moneyInputValue(loan.remainingAmountMinorUnits)}
                  loanId={loan.id}
                  requestId={crypto.randomUUID()}
                />
                <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
                  Internal mock balances only. No payroll deduction, Circle,
                  USDC, or blockchain settlement is performed.
                </p>
              </>
            ) : (
              <p className="rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-600">
                {loan.status === "REPAID"
                  ? "This loan has been repaid in full."
                  : "This loan is not in a repayable status."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-5">
            <CardTitle>Repayment history</CardTitle>
            <CardDescription>
              Completed manual and previously recorded repayments.
            </CardDescription>
          </CardHeader>
          {loan.repayments.length > 0 ? (
            <TableContainer className="rounded-none border-x-0 border-b-0 shadow-none">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment</TableHead>
                    <TableHead>Date</TableHead>
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
              description="Completed repayments will appear here."
              title="No repayment history"
            />
          )}
        </Card>
      </section>
    </main>
  );
}
