import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { LendingOfferRepository } from "@/modules/lending/application/ports/lending-offer-repository";
import {
  calculateAvailableMockBalance,
  type EmployeeLendingOverview,
} from "@/modules/lending/domain/lending-offer";

export async function getEmployeeLending(
  actor: AuthenticatedActor | null,
  repository: LendingOfferRepository,
  now = new Date(),
): Promise<EmployeeLendingOverview> {
  const employee = requireEmployee(actor);
  const result = await repository.listForEmployee({
    organizationId: employee.organizationId,
    userId: employee.userId,
    now,
  });

  if (!result) throw new ForbiddenError();

  return {
    ...result,
    availableBalanceMinorUnits: calculateAvailableMockBalance(
      result.mockBalanceMinorUnits,
      result.committedBalanceMinorUnits,
    ),
  };
}
