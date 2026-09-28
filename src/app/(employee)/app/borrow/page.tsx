import type { Metadata } from "next";

import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { getLendingMarketplaceForActor } from "@/modules/lending/index.server";
import { lendingMarketplaceQuerySchema } from "@/modules/lending/schemas/lending-marketplace.schema";
import { LendingMarketplaceView } from "@/modules/lending/ui/lending-marketplace";

export const metadata: Metadata = { title: "Borrow Money" };

export default async function BorrowMarketplacePage({
  searchParams,
}: PageProps<"/app/borrow">) {
  const actor = await requireEmployeePage();
  const query = await searchParams;
  const filters = lendingMarketplaceQuerySchema.parse({
    amountMinorUnits: typeof query.amount === "string" ? query.amount : "",
    maximumDurationDays:
      typeof query.duration === "string" ? query.duration : "",
    sort: typeof query.sort === "string" ? query.sort : undefined,
  });
  const marketplace = await getLendingMarketplaceForActor(actor, filters);

  return <LendingMarketplaceView marketplace={marketplace} />;
}
