import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { InvalidLendingOfferTermsError } from "@/modules/lending/application/errors/lending-offer-errors";
import type { LendingOfferRepository } from "@/modules/lending/application/ports/lending-offer-repository";
import type {
  CreateLendingOfferCommand,
  LendingOfferView,
} from "@/modules/lending/domain/lending-offer";
import { LendingPolicyViolationError } from "@/modules/policies/application/errors";

function hasValidTerms(command: CreateLendingOfferCommand, now: Date): boolean {
  return (
    command.amountMinorUnits > 0n &&
    command.minimumLoanAmountMinorUnits > 0n &&
    command.minimumLoanAmountMinorUnits <=
      command.maximumLoanAmountMinorUnits &&
    command.maximumLoanAmountMinorUnits <= command.amountMinorUnits &&
    Number.isInteger(command.durationDays) &&
    command.durationDays >= 1 &&
    command.durationDays <= 365 &&
    Number.isInteger(command.feeRateBasisPoints) &&
    command.feeRateBasisPoints >= 0 &&
    command.feeRateBasisPoints <= 10_000 &&
    command.expiresAt.getTime() > now.getTime()
  );
}

export async function createLendingOffer(
  actor: AuthenticatedActor | null,
  command: CreateLendingOfferCommand,
  repository: LendingOfferRepository,
  now = new Date(),
): Promise<LendingOfferView> {
  const employee = requireEmployee(actor);

  if (!hasValidTerms(command, now)) {
    throw new InvalidLendingOfferTermsError();
  }

  const result = await repository.createForEmployee({
    organizationId: employee.organizationId,
    userId: employee.userId,
    command,
    now,
  });

  if (result.kind === "MEMBERSHIP_NOT_FOUND") throw new ForbiddenError();
  if (result.kind === "POLICY_VIOLATION") {
    throw new LendingPolicyViolationError(result.violation);
  }
  return result.offer;
}
