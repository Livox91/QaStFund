"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logger } from "@/infrastructure/logging/logger";
import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { InsufficientMockBalanceError } from "@/modules/lending/application/errors/lending-offer-errors";
import { createLendingOfferForActor } from "@/modules/lending/index.server";
import { createLendingOfferSchema } from "@/modules/lending/schemas/create-lending-offer.schema";

export type CreateLendingOfferActionState = Readonly<{
  message?: string;
  fieldErrors?: Partial<
    Record<
      | "amountAvailable"
      | "minimumLoanAmount"
      | "maximumLoanAmount"
      | "durationDays"
      | "feeRatePercent"
      | "expirationDate",
      string[]
    >
  >;
}>;

export async function createLendingOfferAction(
  _previousState: CreateLendingOfferActionState,
  formData: FormData,
): Promise<CreateLendingOfferActionState> {
  const actor = await requireEmployeePage();
  const now = new Date();
  const parsed = createLendingOfferSchema(now).safeParse({
    amountAvailable: formData.get("amountAvailable"),
    minimumLoanAmount: formData.get("minimumLoanAmount"),
    maximumLoanAmount: formData.get("maximumLoanAmount"),
    durationDays: formData.get("durationDays"),
    feeRatePercent: formData.get("feeRatePercent"),
    expirationDate: formData.get("expirationDate"),
  });

  if (!parsed.success) {
    return {
      message: "Review the highlighted fields and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await createLendingOfferForActor(actor, parsed.data, now);
  } catch (error) {
    if (error instanceof InsufficientMockBalanceError) {
      return { message: error.message };
    }

    logger.error("Lending offer creation failed", error);
    return { message: "Unable to create the offer right now. Try again." };
  }

  revalidatePath("/app");
  revalidatePath("/app/lending");
  revalidatePath("/app/borrow");
  redirect("/app/lending?created=1");
}
