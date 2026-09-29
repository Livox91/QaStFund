"use server";

import { revalidatePath } from "next/cache";

import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { fundWalletForActor } from "@/modules/ledger/index.server";
import { fundWalletIdempotencyKeySchema } from "@/modules/ledger/schemas/fund-wallet.schema";

export async function addTestFundsAction(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  const requestId = fundWalletIdempotencyKeySchema.parse(
    formData.get("requestId"),
  );
  await fundWalletForActor(await requireEmployeePage(), {
    amountMinorUnits: 10_000n,
    requestId,
  });
  revalidatePath("/app");
}
