import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { findEmployerOriginationDecisionForLoanForActor } from "@/modules/loan-decisions/application/origination-decisions";
import { getEmployerLoanDetailsForActor } from "@/modules/loans/index.server";
import { employerLoanIdSchema } from "@/modules/loans/schemas/employer-loan.schema";
import { EmployerLoanDetails } from "@/modules/loans/ui/employer-loan-details";

export const metadata: Metadata = { title: "Loan details" };

export default async function EmployerLoanDetailsPage({
  params,
}: PageProps<"/employer/loans/[loanId]">) {
  const actor = await requireEmployerAdminPage();
  const parsedLoanId = employerLoanIdSchema.safeParse((await params).loanId);

  if (!parsedLoanId.success) notFound();

  const [loan, originationDecision] = await Promise.all([
    getEmployerLoanDetailsForActor(actor, parsedLoanId.data),
    findEmployerOriginationDecisionForLoanForActor(actor, parsedLoanId.data),
  ]);

  if (!loan) notFound();

  return (
    <EmployerLoanDetails
      loan={loan}
      originationDecision={originationDecision}
    />
  );
}
