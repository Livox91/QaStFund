import type { Metadata } from "next";

import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { getEmployeeLendingForActor } from "@/modules/lending/index.server";
import { MyLending } from "@/modules/lending/ui/my-lending";

export const metadata: Metadata = { title: "My Lending" };

export default async function MyLendingPage({
  searchParams,
}: PageProps<"/app/lending">) {
  const actor = await requireEmployeePage();
  const now = new Date();
  const overview = await getEmployeeLendingForActor(actor, now);
  const query = await searchParams;

  return (
    <MyLending
      created={query.created === "1"}
      offerUpdated={query.offerUpdated === "1"}
      statusError={query.statusError === "1"}
      overview={overview}
    />
  );
}
