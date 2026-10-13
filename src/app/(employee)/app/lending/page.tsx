import type { Metadata } from "next";

import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployeeLendingForActor } from "@/modules/lending/index.server";
import { MyLending } from "@/modules/lending/ui/my-lending";
import { listFundedLoansForActor } from "@/modules/loans/index.server";

export const metadata: Metadata = { title: "My Lending" };

export default async function MyLendingPage({
  searchParams,
}: PageProps<"/app/lending">) {
  const actor = await requireEmployeePage();
  const now = new Date();
  const [overview, fundedLoans] = await Promise.all([
    getEmployeeLendingForActor(actor, now),
    listFundedLoansForActor(actor),
  ]);
  const query = await searchParams;

  return (
    <MyLending
      created={query.created === "1"}
      fundedLoans={fundedLoans}
      offerUpdated={query.offerUpdated === "1"}
      statusError={query.statusError === "1"}
      overview={overview}
    />
  );
}
