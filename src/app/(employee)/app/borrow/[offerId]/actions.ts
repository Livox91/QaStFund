"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logger } from "@/infrastructure/logging/logger";
import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import {
  BorrowAmountOutOfRangeError,
  BorrowRequestConflictError,
  InsufficientOfferLiquidityError,
  InsufficientLenderBalanceError,
  LendingOfferNotAvailableError,
} from "@/modules/loans/application/errors/borrow-loan-errors";
import { borrowFromOfferForActor } from "@/modules/loans/index.server";
import { confirmBorrowOfferSchema } from "@/modules/loans/schemas/borrow-from-offer.schema";
import { LendingPolicyViolationError } from "@/modules/policies/application/errors";

export type ConfirmBorrowOfferActionState = Readonly<{
  message?: string;
}>;

const expectedErrors = [
  BorrowAmountOutOfRangeError,
  BorrowRequestConflictError,
  InsufficientOfferLiquidityError,
  InsufficientLenderBalanceError,
  LendingOfferNotAvailableError,
  LendingPolicyViolationError,
] as const;

export async function confirmBorrowOfferAction(
  _previousState: ConfirmBorrowOfferActionState,
  formData: FormData,
): Promise<ConfirmBorrowOfferActionState> {
  const actor = await requireEmployeePage();
  const parsed = confirmBorrowOfferSchema.safeParse({
    offerId: formData.get("offerId"),
    amount: formData.get("amount"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      message:
        "The confirmation details are invalid. Review the offer and try again.",
    };
  }

  let loanId: string;

  try {
    const loan = await borrowFromOfferForActor(actor, {
      offerId: parsed.data.offerId,
      amountMinorUnits: parsed.data.amount,
      requestId: parsed.data.requestId,
    });
    loanId = loan.id;
  } catch (error) {
    if (expectedErrors.some((ErrorType) => error instanceof ErrorType)) {
      return { message: (error as Error).message };
    }

    logger.error("Borrowing confirmation failed", error);
    return { message: "Unable to create the loan right now. Try again." };
  }

  revalidatePath("/app");
  revalidatePath("/app/borrow");
  revalidatePath("/app/lending");
  revalidatePath("/employer");
  revalidatePath("/employer/loans");
  redirect(`/app?loanCreated=1&loanId=${loanId}`);
}
