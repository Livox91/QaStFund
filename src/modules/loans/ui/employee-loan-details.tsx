import Link from "next/link";

import { RepaymentForm } from "@/app/(employee)/app/loans/[loanId]/repayment-form";
import { LegacyRepaymentForm } from "@/app/(employee)/app/loans/[loanId]/legacy-repayment-form";
import { EmployeePayrollAuthorization } from "@/modules/payroll-operations/ui/employee-payroll-authorization";
import {
  calculateDaysOverdue,
  type LoanDecision,
} from "@/modules/loan-decisions/domain/loan-decision";
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
  decision,
  loan,
  repaymentRecorded,
  supportsPartialRepayment = false,
}: {
  decision?: LoanDecision | null;
  loan: EmployeeLoanDetailsView;
  repaymentRecorded: boolean;
  supportsPartialRepayment?: boolean;
}) {
  const isOverdue =
    loan.status !== "REPAID" &&
    (decision?.classification === "overdue" ||
      decision?.classification === "default_candidate");
  const daysOverdue = decision
    ? calculateDaysOverdue(loan.repaymentDueAt, decision.evaluatedAt)
    : 0;

  return (
    <main className="app-page">
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
        actions={<StatusDisplay status={isOverdue ? "OVERDUE" : loan.status} />}
        description={`Borrowed from ${loan.lenderName}.`}
        eyebrow="Borrowed loan"
        title={
          loan.status === "REPAID"
            ? "Loan Repaid ✓"
            : isOverdue
              ? "Payment Overdue"
              : "Active Loan"
        }
      />

      {isOverdue ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          This payment is {daysOverdue} {daysOverdue === 1 ? "day" : "days"}
          overdue. You can still make a partial or final payment.
        </p>
      ) : null}

      {repaymentRecorded ? (
        <p
          className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          role="status"
        >
          {loan.status === "REPAID"
            ? `Repayment confirmed. The funds reached ${loan.lenderName} and this loan is now repaid.`
            : `Payment confirmed. The funds reached ${loan.lenderName} and your remaining balance has been updated.`}
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
                label="Borrowed"
                value={
                  <CurrencyDisplay
                    amountMinorUnits={loan.principalAmountMinorUnits}
                    currency={loan.currency}
                  />
                }
              />
              <Detail
                label="Interest"
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
                label={loan.status === "REPAID" ? "Repaid" : "Amount due"}
                value={
                  <CurrencyDisplay
                    amountMinorUnits={loan.totalAgreedAmountMinorUnits}
                    currency={loan.currency}
                  />
                }
              />
              <Detail label="Lender" value={loan.lenderName} />
              <Detail
                label="Started"
                value={dateFormatter.format(loan.startedAt)}
              />
              <Detail
                label="Due"
                value={dateFormatter.format(loan.repaymentDueAt)}
              />
              <Detail
                label="Status"
                value={<StatusDisplay status={loan.status} />}
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
                    className="text-brand"
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

      {loan.repaymentPlans?.[0] ? (
        <Card className="mt-6 overflow-hidden">
          <CardHeader>
            <CardTitle>Installment schedule</CardTitle>
            <CardDescription>
              Version {loan.repaymentPlans[0].version} ·{" "}
              {loan.repaymentPlans[0].termMonths} month
              {loan.repaymentPlans[0].termMonths === 1 ? "" : "s"}. Payments are
              allocated oldest-first.
            </CardDescription>
          </CardHeader>
          <TableContainer className="rounded-none border-x-0 border-b-0 shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Installment</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Payroll proposal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loan.repaymentPlans[0].installments.map((installment) => {
                  const paid = installment.allocations.reduce(
                    (sum, allocation) => sum + allocation.amountMinorUnits,
                    0n,
                  );
                  return (
                    <TableRow key={installment.id}>
                      <TableCell className="font-semibold">
                        {installment.sequence}
                      </TableCell>
                      <TableCell>
                        {dateFormatter.format(installment.dueAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <CurrencyDisplay
                          amountMinorUnits={installment.amountMinorUnits}
                          currency={loan.currency}
                        />
                      </TableCell>
                      <TableCell>
                        {installment.payrollDeductions[0] ? (
                          <div className="space-y-1 text-xs">
                            <p>
                              {installment.payrollDeductions[0].status} ·{" "}
                              {
                                installment.payrollDeductions[0]
                                  .authorizationStatus
                              }
                            </p>
                            {installment.payrollDeductions[0]
                              .authorizationStatus === "NOT_RECORDED" &&
                            installment.payrollDeductions[0].status ===
                              "PROPOSED" ? (
                              <EmployeePayrollAuthorization
                                proposalId={installment.payrollDeductions[0].id}
                              />
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <CurrencyDisplay
                          amountMinorUnits={paid}
                          currency={loan.currency}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <CurrencyDisplay
                          amountMinorUnits={installment.amountMinorUnits - paid}
                          currency={loan.currency}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      ) : null}

      <section className="mt-6 grid items-start gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader>
            <CardTitle>
              {loan.canRepay ? "Repay loan" : "Repayment closed"}
            </CardTitle>
            <CardDescription>
              {loan.canRepay
                ? loan.repaymentBaseUnits === null
                  ? "Make a partial or final payment against the oldest installment."
                  : supportsPartialRepayment
                    ? "Make a partial payment or pay the remaining balance in full."
                    : "Repay the full agreed amount to your lender."
                : "This loan does not accept additional repayments."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loan.canRepay ? (
              <>
                {loan.repaymentBaseUnits === null ? (
                  <LegacyRepaymentForm
                    currency={loan.currency}
                    loanId={loan.id}
                    remainingAmountMinorUnits={loan.remainingAmountMinorUnits.toString()}
                  />
                ) : (
                  <RepaymentForm
                    lenderName={loan.lenderName}
                    loanId={loan.id}
                    remainingBaseUnits={loan.remainingRepaymentBaseUnits!.toString()}
                    supportsPartialRepayment={supportsPartialRepayment}
                  />
                )}
                <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
                  {loan.repaymentBaseUnits === null
                    ? "Each successful payment is recorded separately and cannot exceed the remaining scheduled balance."
                    : supportsPartialRepayment
                      ? "Each payment is sent directly to the lender and reduces the oldest outstanding installment first."
                      : "You will authorize the exact amount due. The payment and loan completion happen together."}
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
              Confirmed repayments for this loan.
            </CardDescription>
          </CardHeader>
          {loan.repayments.length > 0 ? (
            <TableContainer className="rounded-none border-x-0 border-b-0 shadow-none">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Status</TableHead>
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
                        {dateFormatter.format(
                          repayment.completedAt ?? repayment.paidAt,
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusDisplay status={repayment.status} />
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
