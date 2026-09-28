import type { Metadata } from "next";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { listEmployerLoansForActor } from "@/modules/loans/index.server";
import { employerLoanFilterSchema } from "@/modules/loans/schemas/employer-loan.schema";
import { EmployerLoanList } from "@/modules/loans/ui/employer-loan-list";

export const metadata: Metadata = { title: "Loans" };

export default async function EmployerLoansPage({
  searchParams,
}: PageProps<"/employer/loans">) {
  const actor = await requireEmployerAdminPage();
  const query = await searchParams;
  const activeFilter = employerLoanFilterSchema.parse(query.status);
  const loans = await listEmployerLoansForActor(actor, activeFilter);

  return (
    <EmployerLoanList
      activeFilter={activeFilter}
      loans={loans}
      organizationName={actor.organizationName}
    />
  );
}
