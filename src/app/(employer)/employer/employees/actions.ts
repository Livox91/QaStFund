"use server";

import { revalidatePath } from "next/cache";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { updateEmployeeAccessForActor } from "@/modules/policies/index.server";

export async function updateEmployeeAccessAction(formData: FormData) {
  const employeeId = String(formData.get("employeeId"));
  await updateEmployeeAccessForActor(
    await requireEmployerAdminPage(),
    employeeId,
    {
      canBorrow: formData.get("canBorrow") === "true",
      canLend: formData.get("canLend") === "true",
    },
  );
  revalidatePath("/employer/employees");
}
