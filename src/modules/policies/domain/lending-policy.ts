export type LendingPolicyValues = Readonly<{
  lendingEnabled: boolean;
  borrowingEnabled: boolean;
  maxLoanAmountMinorUnits: bigint;
  maxOutstandingDebtMinorUnits: bigint;
  maxActiveLoans: number;
  minInterestRateBasisPoints: number;
  maxInterestRateBasisPoints: number;
  minTermDays: number;
  maxTermDays: number;
}>;

export const DEFAULT_LENDING_POLICY: LendingPolicyValues = Object.freeze({
  lendingEnabled: true,
  borrowingEnabled: true,
  maxLoanAmountMinorUnits: 10_000n,
  maxOutstandingDebtMinorUnits: 25_000n,
  maxActiveLoans: 3,
  minInterestRateBasisPoints: 0,
  maxInterestRateBasisPoints: 500,
  minTermDays: 7,
  maxTermDays: 60,
});

export const OBLIGATION_LOAN_STATUSES = [
  "ACTIVE",
  "OVERDUE",
  "DEFAULTED",
] as const;

export type LendingPolicy = LendingPolicyValues &
  Readonly<{
    id: string;
    organizationId: string;
    policyVersion: number;
    updatedAt: Date;
  }>;

export type BorrowingCapacity = Readonly<{
  maxLoanAmountMinorUnits: bigint;
  maxOutstandingDebtMinorUnits: bigint;
  outstandingDebtMinorUnits: bigint;
  remainingDebtCapacityMinorUnits: bigint;
  activeLoans: number;
  maxActiveLoans: number;
  lendingEnabled: boolean;
  borrowingEnabled: boolean;
  employeeCanBorrow: boolean;
  eligible: boolean;
}>;

export type PolicyViolation =
  | "LENDING_DISABLED"
  | "BORROWING_DISABLED"
  | "EMPLOYEE_CANNOT_LEND"
  | "EMPLOYEE_CANNOT_BORROW"
  | "INTEREST_OUT_OF_RANGE"
  | "TERM_OUT_OF_RANGE"
  | "MAX_LOAN_EXCEEDED"
  | "OUTSTANDING_DEBT_EXCEEDED"
  | "ACTIVE_LOAN_LIMIT_REACHED";

export function validatePolicyConfiguration(
  policy: LendingPolicyValues,
): boolean {
  return (
    policy.maxLoanAmountMinorUnits > 0n &&
    policy.maxOutstandingDebtMinorUnits >= policy.maxLoanAmountMinorUnits &&
    Number.isInteger(policy.maxActiveLoans) &&
    policy.maxActiveLoans > 0 &&
    Number.isInteger(policy.minInterestRateBasisPoints) &&
    policy.minInterestRateBasisPoints >= 0 &&
    Number.isInteger(policy.maxInterestRateBasisPoints) &&
    policy.maxInterestRateBasisPoints >= policy.minInterestRateBasisPoints &&
    policy.maxInterestRateBasisPoints <= 10_000 &&
    Number.isInteger(policy.minTermDays) &&
    policy.minTermDays > 0 &&
    Number.isInteger(policy.maxTermDays) &&
    policy.maxTermDays >= policy.minTermDays &&
    policy.maxTermDays <= 365
  );
}

export function validateOfferAgainstPolicy(
  policy: LendingPolicyValues,
  membership: { canLend: boolean },
  offer: { feeRateBasisPoints: number; durationDays: number },
): PolicyViolation | null {
  if (!policy.lendingEnabled) return "LENDING_DISABLED";
  if (!membership.canLend) return "EMPLOYEE_CANNOT_LEND";
  if (
    offer.feeRateBasisPoints < policy.minInterestRateBasisPoints ||
    offer.feeRateBasisPoints > policy.maxInterestRateBasisPoints
  )
    return "INTEREST_OUT_OF_RANGE";
  if (
    offer.durationDays < policy.minTermDays ||
    offer.durationDays > policy.maxTermDays
  ) {
    return "TERM_OUT_OF_RANGE";
  }
  return null;
}

export function validateBorrowAgainstPolicy(
  policy: LendingPolicyValues,
  membership: { canBorrow: boolean },
  input: {
    amountMinorUnits: bigint;
    outstandingDebtMinorUnits: bigint;
    activeLoans: number;
  },
): PolicyViolation | null {
  if (!policy.lendingEnabled) return "LENDING_DISABLED";
  if (!policy.borrowingEnabled) return "BORROWING_DISABLED";
  if (!membership.canBorrow) return "EMPLOYEE_CANNOT_BORROW";
  if (input.amountMinorUnits > policy.maxLoanAmountMinorUnits)
    return "MAX_LOAN_EXCEEDED";
  if (input.activeLoans >= policy.maxActiveLoans)
    return "ACTIVE_LOAN_LIMIT_REACHED";
  if (
    input.outstandingDebtMinorUnits + input.amountMinorUnits >
    policy.maxOutstandingDebtMinorUnits
  ) {
    return "OUTSTANDING_DEBT_EXCEEDED";
  }
  return null;
}

export function calculateBorrowingCapacity(
  policy: LendingPolicyValues,
  membership: { canBorrow: boolean },
  obligations: { outstandingDebtMinorUnits: bigint; activeLoans: number },
): BorrowingCapacity {
  const remainingDebtCapacityMinorUnits =
    obligations.outstandingDebtMinorUnits < policy.maxOutstandingDebtMinorUnits
      ? policy.maxOutstandingDebtMinorUnits -
        obligations.outstandingDebtMinorUnits
      : 0n;
  return {
    maxLoanAmountMinorUnits: policy.maxLoanAmountMinorUnits,
    maxOutstandingDebtMinorUnits: policy.maxOutstandingDebtMinorUnits,
    outstandingDebtMinorUnits: obligations.outstandingDebtMinorUnits,
    remainingDebtCapacityMinorUnits,
    activeLoans: obligations.activeLoans,
    maxActiveLoans: policy.maxActiveLoans,
    lendingEnabled: policy.lendingEnabled,
    borrowingEnabled: policy.borrowingEnabled,
    employeeCanBorrow: membership.canBorrow,
    eligible:
      policy.lendingEnabled &&
      policy.borrowingEnabled &&
      membership.canBorrow &&
      remainingDebtCapacityMinorUnits > 0n &&
      obligations.activeLoans < policy.maxActiveLoans,
  };
}

export function policySnapshot(policy: LendingPolicy) {
  return {
    version: policy.policyVersion,
    lendingEnabled: policy.lendingEnabled,
    borrowingEnabled: policy.borrowingEnabled,
    maxLoanAmount: policy.maxLoanAmountMinorUnits.toString(),
    maxOutstandingDebt: policy.maxOutstandingDebtMinorUnits.toString(),
    maxActiveLoans: policy.maxActiveLoans,
    minInterestRateBasisPoints: policy.minInterestRateBasisPoints,
    maxInterestRateBasisPoints: policy.maxInterestRateBasisPoints,
    minTermDays: policy.minTermDays,
    maxTermDays: policy.maxTermDays,
  };
}
