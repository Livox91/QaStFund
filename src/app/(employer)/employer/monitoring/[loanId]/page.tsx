import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { listEmployerActionsForActor } from "@/modules/employer-actions/index.server";
import { getLoanReviewForActor } from "@/modules/loan-decisions/index.server";
import { LoanReview } from "@/modules/loan-decisions/ui/loan-review";

export const metadata: Metadata = { title: "Loan review" };
export const dynamic = "force-dynamic";

export default async function LoanReviewPage({
  params,
  searchParams,
}: PageProps<"/employer/monitoring/[loanId]">) {
  const actor = await requireEmployerAdminPage();
  const parsedLoanId = z.uuid().safeParse((await params).loanId);
  if (!parsedLoanId.success) notFound();
  const loan = await getLoanReviewForActor(actor, parsedLoanId.data);
  if (!loan) notFound();
  const actions = await listEmployerActionsForActor(actor, parsedLoanId.data);
  const query = await searchParams;
  return (
    <LoanReview
      actionError={query.actionError === "1"}
      actionRecorded={query.actionRecorded === "1"}
      actions={actions}
      loan={loan}
    />
  );
}
