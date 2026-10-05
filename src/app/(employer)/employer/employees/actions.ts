"use server";

import { revalidatePath } from "next/cache";
import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { updateEmployeeAccessForActor } from "@/modules/policies/index.server";
import {
  resendInvitation,
  revokeInvitation,
} from "@/modules/employee-invitations/infrastructure/invitation-service";
import { emailSender } from "@/modules/notifications/infrastructure/http-email-sender";
import { validateEnvironment } from "@/infrastructure/config/environment";

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

export async function resendEmployeeInvitationAction(formData: FormData) {
  const actor = await requireEmployerAdminPage();
  await enforceUserRateLimit(
    actor,
    "employer.invitation.resend",
    "administrative",
  );
  await resendInvitation({
    actor,
    membershipId: String(formData.get("employeeId")),
    sender: emailSender,
    appUrl: validateEnvironment().APP_URL,
  });
  revalidatePath("/employer/employees");
}

export async function revokeEmployeeInvitationAction(formData: FormData) {
  const actor = await requireEmployerAdminPage();
  await enforceUserRateLimit(
    actor,
    "employer.invitation.revoke",
    "administrative",
  );
  await revokeInvitation({
    actor,
    membershipId: String(formData.get("employeeId")),
  });
  revalidatePath("/employer/employees");
}
