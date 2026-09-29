import { formatMinorUnits } from "@/modules/ledger/api/wallet-response";
import type {
  BorrowingCapacity,
  LendingPolicy,
} from "@/modules/policies/domain/lending-policy";

export function toPolicyResponse(policy: LendingPolicy) {
  return {
    lendingEnabled: policy.lendingEnabled,
    borrowingEnabled: policy.borrowingEnabled,
    maxLoanAmount: formatMinorUnits(policy.maxLoanAmountMinorUnits),
    maxOutstandingDebt: formatMinorUnits(policy.maxOutstandingDebtMinorUnits),
    maxActiveLoans: policy.maxActiveLoans,
    minInterestRate: (policy.minInterestRateBasisPoints / 100).toFixed(2),
    maxInterestRate: (policy.maxInterestRateBasisPoints / 100).toFixed(2),
    minTermDays: policy.minTermDays,
    maxTermDays: policy.maxTermDays,
    policyVersion: policy.policyVersion,
    updatedAt: policy.updatedAt.toISOString(),
  };
}

export function toCapacityResponse(capacity: BorrowingCapacity) {
  return {
    maxLoanAmount: formatMinorUnits(capacity.maxLoanAmountMinorUnits),
    maxOutstandingDebt: formatMinorUnits(capacity.maxOutstandingDebtMinorUnits),
    outstandingDebt: formatMinorUnits(capacity.outstandingDebtMinorUnits),
    remainingDebtCapacity: formatMinorUnits(
      capacity.remainingDebtCapacityMinorUnits,
    ),
    activeLoans: capacity.activeLoans,
    maxActiveLoans: capacity.maxActiveLoans,
    lendingEnabled: capacity.lendingEnabled,
    borrowingEnabled: capacity.borrowingEnabled,
    employeeCanBorrow: capacity.employeeCanBorrow,
    eligible: capacity.eligible,
  };
}
