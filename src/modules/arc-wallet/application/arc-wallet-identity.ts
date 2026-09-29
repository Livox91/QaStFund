import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { ArcWalletRepository } from "@/modules/arc-wallet/application/ports/arc-wallet-repository";

export function createCircleUsername(userId: string): string {
  return `employee_${userId.replaceAll("-", "").toLowerCase()}`;
}

export async function beginArcWalletEnrollment(
  actor: AuthenticatedActor | null,
  intent: "CREATE" | "RECOVER",
  repository: ArcWalletRepository,
) {
  const employee = requireEmployee(actor);
  const result = await repository.beginEnrollment({
    organizationId: employee.organizationId,
    userId: employee.userId,
    intent,
  });
  return {
    action: result.action,
    username:
      result.action === "REGISTER"
        ? createCircleUsername(employee.userId)
        : null,
  };
}

export async function markArcWalletRegistrationComplete(
  actor: AuthenticatedActor | null,
  repository: ArcWalletRepository,
) {
  const employee = requireEmployee(actor);
  await repository.markRegistrationComplete({
    organizationId: employee.organizationId,
    userId: employee.userId,
  });
}
