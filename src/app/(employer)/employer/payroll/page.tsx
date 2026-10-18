import type { Metadata } from "next";
import Link from "next/link";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { listPayrollDeductions } from "@/modules/payroll-operations/index.server";
import { listPayrollEmployeesForActor } from "@/modules/payroll-integration/application/salary-slips";
import { SalarySlipOperations } from "@/modules/payroll-integration/ui/salary-slip-operations";
import { PayrollActions } from "@/modules/payroll-operations/ui/payroll-actions";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

export const metadata: Metadata = { title: "Payroll deductions" };
export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const actor = await requireEmployerAdminPage();
  const [proposals, payrollEmployees] = await Promise.all([
    listPayrollDeductions(actor),
    listPayrollEmployeesForActor(actor),
  ]);
  return (
    <main className="app-page app-page-wide space-y-6">
      <PageHeader
        eyebrow="Employer operations"
        title="Payroll deductions"
        description="Review employee-authorized proposals and reconcile only externally verified payroll results. Proposals are not repayments."
      />
      <Card>
        <CardHeader>
          <CardTitle>Frappe HR salary slips</CardTitle>
          <CardDescription>
            Retrieve minimal payroll evidence or create a calculated draft.
            QastFund never submits or cancels salary slips.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SalarySlipOperations employees={payrollEmployees} />
        </CardContent>
      </Card>
      <TableContainer>
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
                  <Link
                    className="text-brand font-medium underline-offset-4 hover:underline"
                    href={`/employer/loans/${proposal.loanId}`}
                  >
                    {proposal.loanId.slice(0, 8)}
                  </Link>
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
      </TableContainer>
    </main>
  );
}
