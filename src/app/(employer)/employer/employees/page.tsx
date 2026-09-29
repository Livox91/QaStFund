import type { Metadata } from "next";

import { updateEmployeeAccessAction } from "@/app/(employer)/employer/employees/actions";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
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
  const employees = await listEmployerEmployeesForActor(
    await requireEmployerAdminPage(),
  );
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        description="Manage employee borrowing and lending eligibility."
        eyebrow="Employer portal"
        title="Employees"
      />
      <TableContainer className="mt-8">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Borrowing</TableHead>
              <TableHead>Lending</TableHead>
              <TableHead>Active loans</TableHead>
              <TableHead>Outstanding debt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((employee) => (
              <TableRow key={employee.id}>
                <TableCell className="font-medium">{employee.name}</TableCell>
                <TableCell>
                  <AccessButton
                    employeeId={employee.id}
                    nextBorrow={!employee.canBorrow}
                    nextLend={employee.canLend}
                    enabled={employee.canBorrow}
                    label="borrowing"
                  />
                </TableCell>
                <TableCell>
                  <AccessButton
                    employeeId={employee.id}
                    nextBorrow={employee.canBorrow}
                    nextLend={!employee.canLend}
                    enabled={employee.canLend}
                    label="lending"
                  />
                </TableCell>
                <TableCell>{employee.activeLoans}</TableCell>
                <TableCell>
                  <CurrencyDisplay
                    amountMinorUnits={employee.outstandingDebtMinorUnits}
                    currency="USDC"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </main>
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
