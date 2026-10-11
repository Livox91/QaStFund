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
import { formatInvitationRateLimitMessage } from "@/app/(employer)/employer/employees/invitation-action-state";
import { RateLimitExceededError } from "@/shared/errors/rate-limit-error";

export type InvitationActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
}>;

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

export async function resendEmployeeInvitationAction(
  _previousState: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  try {
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
    return { status: "success", message: "Invitation sent." };
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return {
        status: "error",
        message: formatInvitationRateLimitMessage(error.retryAfterSeconds),
      };
    }
    throw error;
  }
}

export async function revokeEmployeeInvitationAction(
  _previousState: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  try {
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
    return { status: "success", message: "Invitation revoked." };
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return {
        status: "error",
        message: formatInvitationRateLimitMessage(error.retryAfterSeconds),
      };
    }
    throw error;
  }
}
