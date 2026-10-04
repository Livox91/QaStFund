"use server";

import { revalidatePath } from "next/cache";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { updateEmployeeAccessForActor } from "@/modules/policies/index.server";

export async function updateEmployeeAccessAction(formData: FormData) {
  const actor = await requireEmployerAdminPage();
  await enforceUserRateLimit(
    actor,
    "employer.employee-access.update",
    "administrative",
  );
  const employeeId = String(formData.get("employeeId"));
  await updateEmployeeAccessForActor(actor, employeeId, {
    canBorrow: formData.get("canBorrow") === "true",
    canLend: formData.get("canLend") === "true",
  });
  revalidatePath("/employer/employees");
}
