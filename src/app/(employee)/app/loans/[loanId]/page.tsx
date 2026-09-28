import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { EmployeeLoanNotFoundError } from "@/modules/loans/application/errors/repay-loan-errors";
import { getEmployeeLoanDetailsForActor } from "@/modules/loans/index.server";
import { employeeLoanIdSchema } from "@/modules/loans/schemas/repay-loan.schema";
import { EmployeeLoanDetails } from "@/modules/loans/ui/employee-loan-details";

export const metadata: Metadata = { title: "Loan details" };

export default async function EmployeeLoanDetailsPage({
  params,
  searchParams,
}: PageProps<"/app/loans/[loanId]">) {
  const actor = await requireEmployeePage();
  const parsedLoanId = employeeLoanIdSchema.safeParse((await params).loanId);

  if (!parsedLoanId.success) notFound();

  let loan;
  try {
    loan = await getEmployeeLoanDetailsForActor(actor, parsedLoanId.data);
  } catch (error) {
    if (error instanceof EmployeeLoanNotFoundError) notFound();
    throw error;
  }

  const query = await searchParams;

  return (
    <EmployeeLoanDetails loan={loan} repaymentRecorded={query.repaid === "1"} />
  );
}
