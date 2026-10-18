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
  repaymentBaseUnits: bigint | null;
  currency: string;
  durationDays: number;
  feeRateBasisPoints: number;
  status: EmployerLoanStatus;
  startedAt: Date;
  repaymentDueAt: Date;
  repayments: ReadonlyArray<EmployeeLoanRepayment>;
  repaymentPlans?: ReadonlyArray<
    Readonly<{
      id: string;
      version: number;
      termMonths: number;
      installments: ReadonlyArray<
        Readonly<{
          id: string;
          sequence: number;
          amountMinorUnits: bigint;
          dueAt: Date;
          allocations: ReadonlyArray<Readonly<{ amountMinorUnits: bigint }>>;
          payrollDeductions: ReadonlyArray<
            Readonly<{
              id: string;
              status: string;
              authorizationStatus: string;
              proposedAmountMinorUnits: bigint;
              payrollPeriodStart: Date;
              payrollPeriodEnd: Date;
            }>
          >;
        }>
      >;
    }>
  >;
}>;

export type EmployeeBorrowedLoanDetails = EmployeeBorrowedLoanRecord &
  Readonly<{
    totalAgreedAmountMinorUnits: bigint;
    repaidAmountMinorUnits: bigint;
    remainingAmountMinorUnits: bigint;
    remainingRepaymentBaseUnits: bigint | null;
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
  const repaidBaseUnits = loan.repayments.reduce(
    (total, repayment) => total + repayment.amountMinorUnits * 10_000n,
    0n,
  );
  const remainingRepaymentBaseUnits =
    loan.repaymentBaseUnits === null
      ? null
      : loan.repaymentBaseUnits > repaidBaseUnits
        ? loan.repaymentBaseUnits - repaidBaseUnits
        : 0n;

  return {
    ...loan,
    ...progress,
    remainingRepaymentBaseUnits,
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
