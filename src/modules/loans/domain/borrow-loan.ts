import { calculateEstimatedRepayment } from "@/modules/lending/domain/lending-offer";

export type BorrowableOffer = Readonly<{
  id: string;
  availableAmountMinorUnits: bigint;
  minimumLoanAmountMinorUnits: bigint;
  maximumLoanAmountMinorUnits: bigint;
  currency: string;
  durationDays: number;
  feeRateBasisPoints: number;
  expiresAt: Date;
}>;

export type BorrowLoanCommand = Readonly<{
  offerId: string;
  amountMinorUnits: bigint;
  requestId: string;
}>;

export type CreatedBorrowingLoan = Readonly<{
  id: string;
  offerId: string;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  totalRepaymentMinorUnits: bigint;
  currency: string;
  durationDays: number;
  feeRateBasisPoints: number;
  repaymentDueAt: Date;
}>;

export type BorrowLoanSummary = Readonly<{
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  totalRepaymentMinorUnits: bigint;
  repaymentDueAt: Date;
}>;

export function calculateBorrowLoanSummary(
  offer: Pick<BorrowableOffer, "durationDays" | "feeRateBasisPoints">,
  principalAmountMinorUnits: bigint,
  startedAt: Date,
): BorrowLoanSummary {
  const totalRepaymentMinorUnits = calculateEstimatedRepayment(
    principalAmountMinorUnits,
    offer.feeRateBasisPoints,
  );

  return {
    principalAmountMinorUnits,
    feeAmountMinorUnits: totalRepaymentMinorUnits - principalAmountMinorUnits,
    totalRepaymentMinorUnits,
    repaymentDueAt: new Date(
      startedAt.getTime() + offer.durationDays * 24 * 60 * 60 * 1_000,
    ),
  };
}

export function isAmountWithinOfferTerms(
  offer: Pick<
    BorrowableOffer,
    | "availableAmountMinorUnits"
    | "minimumLoanAmountMinorUnits"
    | "maximumLoanAmountMinorUnits"
  >,
  amountMinorUnits: bigint,
): boolean {
  return (
    amountMinorUnits >= offer.minimumLoanAmountMinorUnits &&
    amountMinorUnits <= offer.maximumLoanAmountMinorUnits &&
    amountMinorUnits <= offer.availableAmountMinorUnits
  );
}
