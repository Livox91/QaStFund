import type { LendingOfferView } from "@/modules/lending/domain/lending-offer";

function formatMinorUnits(amount: bigint): string {
  const whole = amount / 100n;
  const fraction = (amount % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = (basisPoints % 100).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function toLendingOfferResponse(offer: LendingOfferView) {
  return {
    id: offer.id,
    totalAmount: formatMinorUnits(offer.amountMinorUnits),
    availableAmount: formatMinorUnits(offer.availableAmountMinorUnits),
    interestRate: formatBasisPoints(offer.feeRateBasisPoints),
    termDays: offer.durationDays,
    maxAmountPerBorrower: formatMinorUnits(offer.maximumLoanAmountMinorUnits),
    currency: offer.currency,
    status: offer.status,
    expiresAt: offer.expiresAt.toISOString(),
    createdAt: offer.createdAt.toISOString(),
    lender: offer.lender,
  } as const;
}
