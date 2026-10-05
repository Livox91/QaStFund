import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployerEmployeeProfileForActor } from "@/modules/policies/index.server";
import { CurrencyDisplay } from "@/shared/ui/currency-display";
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

export const metadata: Metadata = { title: "Employee history" };

export default async function EmployerEmployeeProfilePage({
  params,
}: PageProps<"/employer/employees/[employeeId]">) {
  const { employeeId } = await params;
  let employee;
  try {
    employee = await getEmployerEmployeeProfileForActor(
      await requireEmployerAdminPage(),
      employeeId,
    );
  } catch {
    notFound();
  }
  const mapping = employee.employeeDirectoryMappings[0];
  const former = !employee.isActive || employee.employmentStatus !== "ACTIVE";
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        description="Employment identity and preserved financial history."
        eyebrow="Employee profile"
        title={employee.user.name}
      />
      <Link
        className="mt-4 inline-block text-sm font-medium text-slate-700 hover:text-slate-950"
        href="/employer/employees"
      >
        ← Back to employees
      </Link>
      <section className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Status" value={former ? "Former employee" : "Active"} />
        <Detail label="Email" value={mapping?.email ?? employee.user.email} />
        <Detail
          label="Employee ID"
          value={mapping?.employeeCode ?? mapping?.externalEmployeeId ?? "—"}
        />
        <Detail label="Department" value={mapping?.department ?? "—"} />
        <Detail label="Designation" value={mapping?.designation ?? "—"} />
        <Detail
          label="Removed"
          value={employee.removedAt?.toLocaleString() ?? "—"}
        />
      </section>
      <HistoryTable
        empty="No borrowing history."
        rows={employee.loansAsBorrower}
        title="Loans as borrower"
      />
      <HistoryTable
        empty="No lending history."
        rows={employee.loansAsLender}
        title="Loans as lender"
      />
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-slate-950">Audit history</h2>
        <TableContainer className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employee.auditEventsTargeted.length ? (
                employee.auditEventsTargeted.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{event.occurredAt.toLocaleString()}</TableCell>
                    <TableCell>{event.title}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={2}>No audit events.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </section>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

type LoanRow = {
  id: string;
  status: string;
  principalAmountMinorUnits: bigint;
  outstandingPrincipalMinorUnits: bigint;
  currency: string;
  startedAt: Date;
  repaymentDueAt: Date;
};

function HistoryTable({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: LoanRow[];
  empty: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <TableContainer className="mt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Principal</TableHead>
              <TableHead>Outstanding</TableHead>
              <TableHead>Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((loan) => (
                <TableRow key={loan.id}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      href={`/employer/loans/${loan.id}`}
                    >
                      {loan.startedAt.toLocaleDateString()}
                    </Link>
                  </TableCell>
                  <TableCell>{loan.status}</TableCell>
                  <TableCell>
                    <CurrencyDisplay
                      amountMinorUnits={loan.principalAmountMinorUnits}
                      currency={loan.currency}
                    />
                  </TableCell>
                  <TableCell>
                    <CurrencyDisplay
                      amountMinorUnits={loan.outstandingPrincipalMinorUnits}
                      currency={loan.currency}
                    />
                  </TableCell>
                  <TableCell>
                    {loan.repaymentDueAt.toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5}>{empty}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
}
