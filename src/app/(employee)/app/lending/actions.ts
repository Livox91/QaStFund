"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logger } from "@/infrastructure/logging/logger";
import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import { ApplicationError } from "@/shared/errors/application-error";
import { updateLendingOfferStatusForActor } from "@/modules/lending/index.server";
import {
  lendingOfferIdSchema,
  updateLendingOfferStatusSchema,
} from "@/modules/lending/schemas/lending-offer-api.schema";

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
