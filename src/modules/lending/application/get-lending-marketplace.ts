import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { LendingOfferRepository } from "@/modules/lending/application/ports/lending-offer-repository";
import type {
  LendingMarketplace,
  LendingMarketplaceFilters,
} from "@/modules/lending/domain/lending-offer";

export async function getLendingMarketplace(
  actor: AuthenticatedActor | null,
  filters: LendingMarketplaceFilters,
  repository: LendingOfferRepository,
  now = new Date(),
): Promise<LendingMarketplace> {
  const employee = requireEmployee(actor);
  const result = await repository.listMarketplace({
    organizationId: employee.organizationId,
    userId: employee.userId,
    now,
    filters,
  });

  if (!result) throw new ForbiddenError();

  return { ...result, filters };
}
