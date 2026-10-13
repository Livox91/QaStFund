import type { Metadata } from "next";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { listPayrollDeductions } from "@/modules/payroll-operations/index.server";
import { PayrollActions } from "@/modules/payroll-operations/ui/payroll-actions";
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

export const metadata: Metadata = { title: "Payroll deductions" };
export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const actor = await requireEmployerAdminPage();
  const proposals = await listPayrollDeductions(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Employer operations"
        title="Payroll deductions"
        description="Review employee-authorized proposals and reconcile only externally verified payroll results. Proposals are not repayments."
      />
      <div className="overflow-x-auto rounded-xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period / employee</TableHead>
              <TableHead>Loan / installment</TableHead>
              <TableHead>Due / proposed / actual</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>ERPNext</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.map((proposal) => (
              <TableRow key={proposal.id}>
                <TableCell>
                  {proposal.payrollPeriodStart.toLocaleDateString()}–
                  {proposal.payrollPeriodEnd.toLocaleDateString()}
                  <br />
                  <span className="text-xs text-slate-500">
                    {proposal.employeeMapping.fullName} ·{" "}
                    {proposal.employeeMapping.externalEmployeeId}
                  </span>
                </TableCell>
                <TableCell>
                  <a
                    className="text-brand underline"
                    href={`/employer/loans/${proposal.loanId}`}
                  >
                    {proposal.loanId.slice(0, 8)}
                  </a>
                  <br />
                  Installment {proposal.installment.sequence}
                </TableCell>
                <TableCell>
                  <CurrencyDisplay
                    amountMinorUnits={proposal.outstandingAmountMinorUnits}
                    currency={proposal.currency}
                  />{" "}
                  /{" "}
                  <CurrencyDisplay
                    amountMinorUnits={proposal.proposedAmountMinorUnits}
                    currency={proposal.currency}
                  />{" "}
                  /{" "}
                  <CurrencyDisplay
                    amountMinorUnits={proposal.actualDeductedMinorUnits}
                    currency={proposal.currency}
                  />
                </TableCell>
                <TableCell>
                  {proposal.authorizationStatus}
                  <br />
                  {proposal.status}
                </TableCell>
                <TableCell>
                  {proposal.erpNextDocumentReference ??
                    proposal.lastSyncErrorCode ??
                    "Not submitted"}
                </TableCell>
                <TableCell>
                  <PayrollActions
                    authorized={proposal.authorizationStatus === "AUTHORIZED"}
                    id={proposal.id}
                    status={proposal.status}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {proposals.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No payroll deduction proposals exist for this organization.
          </p>
        ) : null}
      </div>
    </div>
  );
}
