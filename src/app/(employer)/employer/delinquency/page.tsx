import type { Metadata } from "next";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { listDelinquencyCases } from "@/modules/payroll-operations/index.server";
import { DelinquencyActions } from "@/modules/payroll-operations/ui/delinquency-actions";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import { PageHeader } from "@/shared/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

export const metadata: Metadata = { title: "Repayment exceptions" };
export const dynamic = "force-dynamic";

export default async function DelinquencyPage() {
  const actor = await requireEmployerAdminPage();
  const cases = await listDelinquencyCases(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Employer operations"
        title="Repayment exceptions"
        description="Confirmed outstanding installments after the configured reconciliation window. Recommendations require human review."
      />
      <div className="overflow-x-auto rounded-xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee / loan</TableHead>
              <TableHead>Installment</TableHead>
              <TableHead>Paid / outstanding</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Payroll</TableHead>
              <TableHead>Notifications</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.map((record) => (
              <TableRow key={record.id}>
                <TableCell>
                  {record.loan.borrowerMembership.user.name}
                  <br />
                  <a
                    className="text-brand underline"
                    href={`/employer/loans/${record.loanId}`}
                  >
                    {record.loanId.slice(0, 8)}
                  </a>
                </TableCell>
                <TableCell>
                  #{record.installment.sequence}
                  <br />
                  Due {record.installment.dueAt.toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <CurrencyDisplay
                    amountMinorUnits={record.amountPaidMinorUnits}
                    currency={record.loan.currency}
                  />{" "}
                  /{" "}
                  <CurrencyDisplay
                    amountMinorUnits={record.outstandingMinorUnits}
                    currency={record.loan.currency}
                  />
                </TableCell>
                <TableCell>
                  {record.status} · {record.state}
                  <br />
                  {record.daysOverdue} days
                  <br />
                  <span className="text-xs text-slate-500">
                    {record.recommendedAction}
                  </span>
                </TableCell>
                <TableCell>{record.payrollStatus ?? "No proposal"}</TableCell>
                <TableCell>
                  {record.notifications
                    .map(
                      (item) => `${item.thresholdKey}: ${item.deliveryStatus}`,
                    )
                    .join(", ") || "None"}
                </TableCell>
                <TableCell>
                  <DelinquencyActions
                    hasFailedNotification={record.notifications.some(
                      (item) => item.deliveryStatus === "FAILED",
                    )}
                    id={record.id}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {cases.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No repayment exceptions have been recorded.
          </p>
        ) : null}
      </div>
    </div>
  );
}
