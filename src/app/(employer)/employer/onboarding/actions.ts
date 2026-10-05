"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { synchronizeEmployeesForActor } from "@/modules/employee-directory/index.server";
import {
  setEmployerErpNextEnabledForActor,
  startInitialEmployeeSynchronizationForActor,
  updateEmployerOrganizationNameForActor,
} from "@/modules/organizations/index.server";
import { updatePolicyForActor } from "@/modules/policies/index.server";
import { lendingPolicySchema } from "@/modules/policies/schemas/lending-policy.schema";

export type OnboardingActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const organizationNameSchema = z.string().trim().min(2).max(120);

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return "Check the highlighted values and try again.";
  if (
    error instanceof Error &&
    ["DIRECTORY_NOT_AVAILABLE", "ERP_NEXT_NOT_READY"].includes(error.message)
  ) {
    return "Configure the ERPNext connection before starting the import.";
  }
  return "The setup change could not be saved. Try again or contact an operator.";
}

function revalidateOnboarding() {
  revalidatePath("/employer/onboarding");
  revalidatePath("/employer");
  revalidatePath("/employer/integrations");
  revalidatePath("/employer/policies");
}

export async function updateOrganizationProfileAction(
  _state: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  try {
    const actor = await requireEmployerAdminPage();
    await enforceUserRateLimit(
      actor,
      "employer.onboarding.profile",
      "administrative",
    );
    const name = organizationNameSchema.parse(formData.get("organizationName"));
    await updateEmployerOrganizationNameForActor(actor, name);
    revalidateOnboarding();
    return { status: "success", message: "Organization profile saved." };
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

export async function updateErpNextEnabledAction(
  _state: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  try {
    const actor = await requireEmployerAdminPage();
    await enforceUserRateLimit(
      actor,
      "employer.onboarding.erpnext",
      "administrative",
    );
    const enabled = formData.get("erpNextEnabled") === "on";
    await setEmployerErpNextEnabledForActor(actor, enabled);
    revalidateOnboarding();
    return {
      status: "success",
      message: enabled
        ? "ERPNext employee import enabled. Configure and test the connection next."
        : "ERPNext employee import disabled.",
    };
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

export async function updateOnboardingPolicyAction(
  _state: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  try {
    const actor = await requireEmployerAdminPage();
    await enforceUserRateLimit(
      actor,
      "employer.onboarding.policy",
      "administrative",
    );
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
    revalidateOnboarding();
    return { status: "success", message: "Lending policy saved." };
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }
}

export async function initialEmployeeSyncAction(
  _state: OnboardingActionState,
): Promise<OnboardingActionState> {
  void _state;
  try {
    const actor = await requireEmployerAdminPage();
    await enforceUserRateLimit(actor, "employer.onboarding.sync", "expensive");
    const result = await startInitialEmployeeSynchronizationForActor(
      actor,
      synchronizeEmployeesForActor,
    );
    revalidateOnboarding();
    return {
      status: result.status === "success" ? "success" : "error",
      message: `Found ${result.processedCount}; imported ${result.createdCount}, updated ${result.updatedCount}, removed ${result.deactivatedCount}, reactivated ${result.reactivatedCount}; ${result.invitationFailureCount} invitation emails need attention.`,
    };
  } catch (error) {
    revalidateOnboarding();
    return { status: "error", message: errorMessage(error) };
  }
}
