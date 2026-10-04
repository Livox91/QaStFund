"use server";

import { revalidatePath } from "next/cache";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { updatePolicyForActor } from "@/modules/policies/index.server";
import { lendingPolicySchema } from "@/modules/policies/schemas/lending-policy.schema";

export async function updateLendingPolicyAction(formData: FormData) {
  const actor = await requireEmployerAdminPage();
  await enforceUserRateLimit(actor, "employer.policy.update", "administrative");
  const parsed = lendingPolicySchema.parse({
    lendingEnabled: formData.get("lendingEnabled") === "on",
    borrowingEnabled: formData.get("borrowingEnabled") === "on",
    maxLoanAmount: formData.get("maxLoanAmount"),
    maxOutstandingDebt: formData.get("maxOutstandingDebt"),
    maxActiveLoans: Number(formData.get("maxActiveLoans")),
    minInterestRate: formData.get("minInterestRate"),
    maxInterestRate: formData.get("maxInterestRate"),
    minTermDays: Number(formData.get("minTermDays")),
    maxTermDays: Number(formData.get("maxTermDays")),
  });
  await updatePolicyForActor(actor, {
    lendingEnabled: parsed.lendingEnabled,
    borrowingEnabled: parsed.borrowingEnabled,
    maxLoanAmountMinorUnits: parsed.maxLoanAmount,
    maxOutstandingDebtMinorUnits: parsed.maxOutstandingDebt,
    maxActiveLoans: parsed.maxActiveLoans,
    minInterestRateBasisPoints: parsed.minInterestRate,
    maxInterestRateBasisPoints: parsed.maxInterestRate,
    minTermDays: parsed.minTermDays,
    maxTermDays: parsed.maxTermDays,
  });
  revalidatePath("/employer/policies");
  revalidatePath("/app");
}
