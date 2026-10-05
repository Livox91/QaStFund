import type { Metadata } from "next";
import Link from "next/link";

import {
  resendEmployeeInvitationAction,
  revokeEmployeeInvitationAction,
  updateEmployeeAccessAction,
} from "@/app/(employer)/employer/employees/actions";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { partitionEmployeesByLifecycle } from "@/modules/employee-directory/domain/employee-lifecycle";
import { getEmployeeDirectoryDashboardForActor } from "@/modules/employee-directory/index.server";
import { listEmployerEmployeesForActor } from "@/modules/policies/index.server";
import { Button } from "@/shared/ui/button";
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

export const metadata: Metadata = { title: "Employees" };

export default async function EmployerEmployeesPage() {
  const actor = await requireEmployerAdminPage();
  const [employees, directory] = await Promise.all([
    listEmployerEmployeesForActor(actor),
    getEmployeeDirectoryDashboardForActor(actor),
  ]);
  const { active: activeEmployees, former: formerEmployees } =
    partitionEmployeesByLifecycle(employees);
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        description="Manage employee borrowing and lending eligibility."
        eyebrow="Employer portal"
        title="Employees"
      />
      <EmployeeTable
        employees={activeEmployees}
        title={`Active Employees (${activeEmployees.length})`}
      />
      {directory.reviewRecords.length > 0 ? (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Employees needing review ({directory.reviewRecords.length})
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Employment status is managed in ERPNext. Correct the source
                record or status mapping, then run synchronization again.
              </p>
            </div>
            <Link
              className="text-sm font-semibold text-teal-700 underline-offset-4 hover:underline"
              href="/employer/integrations#review-unmatched"
            >
              Review and resolve
            </Link>
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {directory.reviewRecords.map((record) => (
              <li
                className="rounded-xl border border-amber-200 bg-white p-4"
                key={record.externalEmployeeId}
              >
                <p className="font-semibold text-slate-950">
                  {record.fullName}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {record.email ?? "Missing employee email"} ·{" "}
                  {record.externalStatus}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <EmployeeTable
        employees={formerEmployees}
        former
        title={`Removed / Former Employees (${formerEmployees.length})`}
      />
    </main>
  );
}

type EmployeeRow = Awaited<
  ReturnType<typeof listEmployerEmployeesForActor>
>[number];

function EmployeeTable({
  employees,
  former = false,
  title,
}: {
  employees: EmployeeRow[];
  former?: boolean;
  title: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <TableContainer className="mt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Borrowing</TableHead>
              <TableHead>Lending</TableHead>
              <TableHead>Active loans</TableHead>
              <TableHead>Outstanding debt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  {former
                    ? "No former employees."
                    : "No active employees have been synchronized."}
                </TableCell>
              </TableRow>
            ) : (
              employees.map((employee) => (
                <TableRow key={employee.id}>
                  <TableCell>
                    <Link
                      className="font-medium text-slate-950 underline-offset-4 hover:underline"
                      href={`/employer/employees/${employee.id}`}
                    >
                      {employee.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {employee.email}
                    </div>
                    {employee.employeeCode ? (
                      <div className="text-xs text-slate-400">
                        {employee.employeeCode}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {former
                        ? "Former employee"
                        : employee.accountActivatedAt
                          ? "Active"
                          : employee.invitation?.status === "PENDING"
                            ? employee.invitation.expiresAt <= new Date()
                              ? "Invitation expired"
                              : "Invited"
                            : employee.invitation?.status === "REVOKED"
                              ? "Invitation revoked"
                              : "Not invited"}
                    </span>
                    {former && employee.removedAt ? (
                      <div className="text-xs text-slate-500">
                        Removed {employee.removedAt.toLocaleDateString()}
                      </div>
                    ) : null}
                  </TableCell>
                  {!former && !employee.accountActivatedAt ? (
                    <TableCell colSpan={2}>
                      {employee.invitation ? (
                        <div className="text-xs text-slate-500">
                          Delivery: {employee.invitation.deliveryStatus} · Sent:{" "}
                          {employee.invitation.sentAt?.toLocaleString() ?? "—"}{" "}
                          · Expires:{" "}
                          {employee.invitation.expiresAt.toLocaleString()}
                        </div>
                      ) : null}
                      <div className="mt-2 flex gap-2">
                        <form action={resendEmployeeInvitationAction}>
                          <input
                            name="employeeId"
                            type="hidden"
                            value={employee.id}
                          />
                          <Button size="sm" type="submit">
                            Resend invitation
                          </Button>
                        </form>
                        {employee.invitation?.status === "PENDING" &&
                        employee.invitation.expiresAt > new Date() ? (
                          <form action={revokeEmployeeInvitationAction}>
                            <input
                              name="employeeId"
                              type="hidden"
                              value={employee.id}
                            />
                            <Button size="sm" type="submit" variant="outline">
                              Revoke invitation
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </TableCell>
                  ) : (
                    <>
                      <TableCell>
                        {former ? (
                          "Disabled"
                        ) : (
                          <AccessButton
                            employeeId={employee.id}
                            nextBorrow={!employee.canBorrow}
                            nextLend={employee.canLend}
                            enabled={employee.canBorrow}
                            label="borrowing"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {former ? (
                          "Disabled"
                        ) : (
                          <AccessButton
                            employeeId={employee.id}
                            nextBorrow={employee.canBorrow}
                            nextLend={!employee.canLend}
                            enabled={employee.canLend}
                            label="lending"
                          />
                        )}
                      </TableCell>
                    </>
                  )}
                  <TableCell>{employee.activeLoans}</TableCell>
                  <TableCell>
                    <CurrencyDisplay
                      amountMinorUnits={employee.outstandingDebtMinorUnits}
                      currency="USDC"
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </section>
  );
}

function AccessButton({
  employeeId,
  enabled,
  label,
  nextBorrow,
  nextLend,
}: {
  employeeId: string;
  enabled: boolean;
  label: string;
  nextBorrow: boolean;
  nextLend: boolean;
}) {
  return (
    <form action={updateEmployeeAccessAction}>
      <input name="employeeId" type="hidden" value={employeeId} />
      <input name="canBorrow" type="hidden" value={String(nextBorrow)} />
      <input name="canLend" type="hidden" value={String(nextLend)} />
      <Button
        size="sm"
        type="submit"
        variant={enabled ? "outline" : "secondary"}
      >
        {enabled ? `Disable ${label}` : `Enable ${label}`}
      </Button>
    </form>
  );
}
