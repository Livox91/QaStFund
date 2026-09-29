"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logger } from "@/infrastructure/logging/logger";
import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { ApplicationError } from "@/shared/errors/application-error";
import {
  createLendingOfferForActor,
  updateLendingOfferStatusForActor,
} from "@/modules/lending/index.server";
import { createLendingOfferSchema } from "@/modules/lending/schemas/create-lending-offer.schema";
import {
  lendingOfferIdSchema,
  updateLendingOfferStatusSchema,
} from "@/modules/lending/schemas/lending-offer-api.schema";

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
    if (error instanceof ApplicationError) return { message: error.message };
    logger.error("Lending offer creation failed", error);
    return { message: "Unable to create the offer right now. Try again." };
  }

  revalidatePath("/app");
  revalidatePath("/app/lending");
  revalidatePath("/app/borrow");
  redirect("/app/lending?created=1");
}

export async function updateLendingOfferStatusAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireEmployeePage();
  const parsedId = lendingOfferIdSchema.safeParse(formData.get("offerId"));
  const parsedStatus = updateLendingOfferStatusSchema.safeParse({
    status: formData.get("status"),
  });

  if (!parsedId.success || !parsedStatus.success) {
    redirect("/app/lending?statusError=1");
  }

  try {
    await updateLendingOfferStatusForActor(
      actor,
      parsedId.data,
      parsedStatus.data.status,
    );
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      logger.error("Lending offer status update failed", error);
    }
    redirect("/app/lending?statusError=1");
  }

  revalidatePath("/app/lending");
  revalidatePath("/app/borrow");
  redirect("/app/lending?offerUpdated=1");
}
