export type LendingOfferDisplayStatus =
  "ACTIVE" | "PAUSED" | "CLOSED" | "EXPIRED";

export type LendingOfferView = Readonly<{
  id: string;
  amountMinorUnits: bigint;
  availableAmountMinorUnits: bigint;
  minimumLoanAmountMinorUnits: bigint;
  maximumLoanAmountMinorUnits: bigint;
  currency: string;
  durationDays: number;
  feeRateBasisPoints: number;
  expiresAt: Date;
  createdAt: Date;
  status: LendingOfferDisplayStatus;
}>;

export type EmployeeLendingOverview = Readonly<{
  currency: string;
  mockBalanceMinorUnits: bigint;
  committedBalanceMinorUnits: bigint;
  availableBalanceMinorUnits: bigint;
  offers: ReadonlyArray<LendingOfferView>;
}>;

export type MarketplaceLendingOffer = LendingOfferView;

export const LendingMarketplaceSort = {
  LOWEST_FEE: "lowest-fee",
  MOST_AVAILABLE: "most-available",
  SHORTEST_DURATION: "shortest-duration",
  EXPIRING_SOON: "expiring-soon",
} as const;

export type LendingMarketplaceSort =
  (typeof LendingMarketplaceSort)[keyof typeof LendingMarketplaceSort];

export type LendingMarketplaceFilters = Readonly<{
  amountMinorUnits?: bigint;
  maximumDurationDays?: number;
  sort: LendingMarketplaceSort;
}>;

export type LendingMarketplace = Readonly<{
  currency: string;
  offers: ReadonlyArray<MarketplaceLendingOffer>;
  filters: LendingMarketplaceFilters;
}>;

export type CreateLendingOfferCommand = Readonly<{
  amountMinorUnits: bigint;
  minimumLoanAmountMinorUnits: bigint;
  maximumLoanAmountMinorUnits: bigint;
  durationDays: number;
  feeRateBasisPoints: number;
  expiresAt: Date;
}>;

export function getLendingOfferDisplayStatus(
  status: "ACTIVE" | "PAUSED" | "CLOSED",
  expiresAt: Date,
  now: Date,
): LendingOfferDisplayStatus {
  if (status === "ACTIVE" && expiresAt.getTime() <= now.getTime()) {
    return "EXPIRED";
  }

  return status;
}

export function calculateAvailableMockBalance(
  balanceMinorUnits: bigint,
  committedMinorUnits: bigint,
): bigint {
  return committedMinorUnits >= balanceMinorUnits
    ? 0n
    : balanceMinorUnits - committedMinorUnits;
}

export function formatBasisPointsAsPercent(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;

  return fraction === 0
    ? `${whole}%`
    : `${whole}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}%`;
}

export function calculateEstimatedRepayment(
  principalMinorUnits: bigint,
  feeRateBasisPoints: number,
): bigint {
  const feeMinorUnits =
    (principalMinorUnits * BigInt(feeRateBasisPoints) + 9_999n) / 10_000n;

  return principalMinorUnits + feeMinorUnits;
}

export function getCurrentlyBorrowableMaximum(
  offer: Pick<
    LendingOfferView,
    "availableAmountMinorUnits" | "maximumLoanAmountMinorUnits"
  >,
): bigint {
  return offer.availableAmountMinorUnits < offer.maximumLoanAmountMinorUnits
    ? offer.availableAmountMinorUnits
    : offer.maximumLoanAmountMinorUnits;
}
