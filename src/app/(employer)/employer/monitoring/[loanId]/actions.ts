"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { executeEmployerActionForActor } from "@/modules/employer-actions/index.server";
import { employerActionRequestSchema } from "@/modules/employer-actions/schemas/employer-action.schema";

export async function executeEmployerActionAction(formData: FormData) {
  const actor = await requireEmployerAdminPage();
  const parsed = employerActionRequestSchema.safeParse({
    loanId: formData.get("loanId"),
    action: formData.get("action"),
    idempotencyKey: formData.get("idempotencyKey"),
  });
  const fallbackLoanId = z.uuid().safeParse(formData.get("loanId"));
  if (!parsed.success) {
    if (fallbackLoanId.success) {
      redirect(`/employer/monitoring/${fallbackLoanId.data}?actionError=1`);
    }
    redirect("/employer/monitoring");
  }

  let succeeded = false;
  try {
    await executeEmployerActionForActor(actor, parsed.data);
    succeeded = true;
  } catch {
    // Employer-facing responses intentionally omit provider and internal errors.
  }
  revalidatePath("/employer/monitoring");
  revalidatePath(`/employer/monitoring/${parsed.data.loanId}`);
  redirect(
    `/employer/monitoring/${parsed.data.loanId}?${succeeded ? "actionRecorded=1" : "actionError=1"}`,
  );
}
