import {
  calculateLoanFinancialProgress,
  type EmployerLoanStatus,
} from "@/modules/loans/domain/employer-loan";

export type EmployeeLoanRepayment = Readonly<{
  id: string;
  amountMinorUnits: bigint;
  currency: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  createdAt: Date;
  completedAt: Date | null;
  paidAt: Date;
}>;

export type EmployeeBorrowedLoanRecord = Readonly<{
  id: string;
  lenderName: string;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  outstandingPrincipalMinorUnits: bigint;
  currency: string;
  durationDays: number;
  feeRateBasisPoints: number;
  status: EmployerLoanStatus;
  startedAt: Date;
  repaymentDueAt: Date;
  repayments: ReadonlyArray<EmployeeLoanRepayment>;
}>;

export type EmployeeBorrowedLoanDetails = EmployeeBorrowedLoanRecord &
  Readonly<{
    totalAgreedAmountMinorUnits: bigint;
    repaidAmountMinorUnits: bigint;
    remainingAmountMinorUnits: bigint;
    progressBasisPoints: number;
    canRepay: boolean;
  }>;

export type RepayLoanCommand = Readonly<{
  loanId: string;
  amountMinorUnits: bigint;
  requestId: string;
}>;

export type RecordedLoanRepayment = Readonly<{
  id: string;
  loanId: string;
  amountMinorUnits: bigint;
  currency: string;
  paidAt: Date;
  completedAt: Date;
  loanStatus: EmployerLoanStatus;
}>;

export function toEmployeeBorrowedLoanDetails(
  loan: EmployeeBorrowedLoanRecord,
): EmployeeBorrowedLoanDetails {
  const progress = calculateLoanFinancialProgress({
    principalAmountMinorUnits: loan.principalAmountMinorUnits,
    feeAmountMinorUnits: loan.feeAmountMinorUnits,
    repaymentAmountsMinorUnits: loan.repayments.map(
      (repayment) => repayment.amountMinorUnits,
    ),
  });

  return {
    ...loan,
    ...progress,
    canRepay:
      (loan.status === "ACTIVE" || loan.status === "OVERDUE") &&
      progress.remainingAmountMinorUnits > 0n,
  };
}

export function calculatePrincipalReduction(input: {
  feeAmountMinorUnits: bigint;
  previouslyRepaidMinorUnits: bigint;
  repaymentAmountMinorUnits: bigint;
  outstandingPrincipalMinorUnits: bigint;
}): bigint {
  const feeAlreadyPaid =
    input.previouslyRepaidMinorUnits < input.feeAmountMinorUnits
      ? input.previouslyRepaidMinorUnits
      : input.feeAmountMinorUnits;
  const remainingFee = input.feeAmountMinorUnits - feeAlreadyPaid;
  const principalReduction =
    input.repaymentAmountMinorUnits > remainingFee
      ? input.repaymentAmountMinorUnits - remainingFee
      : 0n;

  return principalReduction > input.outstandingPrincipalMinorUnits
    ? input.outstandingPrincipalMinorUnits
    : principalReduction;
}
