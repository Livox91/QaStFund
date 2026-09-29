"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logger } from "@/infrastructure/logging/logger";
import { requireEmployeePage } from "@/modules/auth/infrastructure/auth-guard";
import {
  EmployeeLoanNotFoundError,
  InvalidRepaymentError,
  LoanNotRepayableError,
  RepaymentExceedsRemainingError,
  RepaymentRequestConflictError,
  InsufficientRepaymentBalanceError,
} from "@/modules/loans/application/errors/repay-loan-errors";
import { repayLoanForActor } from "@/modules/loans/index.server";
import { repayLoanSchema } from "@/modules/loans/schemas/repay-loan.schema";

export type RepayLoanActionState = Readonly<{
  message?: string;
  fieldErrors?: Readonly<{ amount?: string[] }>;
}>;

const expectedErrors = [
  EmployeeLoanNotFoundError,
  InvalidRepaymentError,
  LoanNotRepayableError,
  RepaymentExceedsRemainingError,
  RepaymentRequestConflictError,
  InsufficientRepaymentBalanceError,
] as const;

export async function repayLoanAction(
  _previousState: RepayLoanActionState,
  formData: FormData,
): Promise<RepayLoanActionState> {
  const actor = await requireEmployeePage();
  const parsed = repayLoanSchema.safeParse({
    loanId: formData.get("loanId"),
    amount: formData.get("amount"),
    requestId: formData.get("requestId"),
  });

  if (!parsed.success) {
    return {
      message: "Review the repayment amount and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await repayLoanForActor(actor, {
      loanId: parsed.data.loanId,
      amountMinorUnits: parsed.data.amount,
      requestId: parsed.data.requestId,
    });
  } catch (error) {
    if (expectedErrors.some((ErrorType) => error instanceof ErrorType)) {
      return { message: (error as Error).message };
    }

    logger.error("Manual loan repayment failed", error);
    return { message: "Unable to record the repayment right now. Try again." };
  }

  revalidatePath("/app");
  revalidatePath(`/app/loans/${parsed.data.loanId}`);
  revalidatePath("/employer");
  revalidatePath("/employer/loans");
  revalidatePath(`/employer/loans/${parsed.data.loanId}`);
  redirect(`/app/loans/${parsed.data.loanId}?repaid=1`);
}
