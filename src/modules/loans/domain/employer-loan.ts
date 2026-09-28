export const EmployerLoanFilter = {
  ACTIVE: "active",
  REPAID: "repaid",
  OVERDUE: "overdue",
  ALL: "all",
} as const;

export type EmployerLoanFilter =
  (typeof EmployerLoanFilter)[keyof typeof EmployerLoanFilter];

export type EmployerLoanStatus =
  | "REQUESTED"
  | "APPROVED"
  | "ACTIVE"
  | "REPAID"
  | "OVERDUE"
  | "DEFAULTED"
  | "CANCELLED";

export type EmployerLoanRepayment = Readonly<{
  id: string;
  amountMinorUnits: bigint;
  currency: string;
  paidAt: Date;
}>;

export type EmployerLoanAuditEvent = Readonly<{
  id: string;
  type:
    | "LOAN_REQUESTED"
    | "LOAN_APPROVED"
    | "LOAN_CREATED"
    | "LOAN_ACTIVATED"
    | "REPAYMENT_RECORDED"
    | "LOAN_REPAID"
    | "LOAN_OVERDUE"
    | "LOAN_DEFAULTED"
    | "LOAN_CANCELLED";
  title: string;
  actorLabel: string | null;
  occurredAt: Date;
}>;

export type EmployerLoanFinancialProgress = Readonly<{
  totalAgreedAmountMinorUnits: bigint;
  repaidAmountMinorUnits: bigint;
  remainingAmountMinorUnits: bigint;
  progressBasisPoints: number;
}>;

export type EmployerLoanListItem = Readonly<{
  id: string;
  borrowerName: string;
  lenderName: string;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  currency: string;
  status: EmployerLoanStatus;
  startedAt: Date;
  repaymentDueAt: Date;
}> &
  EmployerLoanFinancialProgress;

export type EmployerLoanDetails = EmployerLoanListItem &
  Readonly<{
    repayments: ReadonlyArray<EmployerLoanRepayment>;
    auditEvents: ReadonlyArray<EmployerLoanAuditEvent>;
  }>;

export function calculateLoanFinancialProgress(input: {
  feeAmountMinorUnits: bigint;
  principalAmountMinorUnits: bigint;
  repaymentAmountsMinorUnits: ReadonlyArray<bigint>;
}): EmployerLoanFinancialProgress {
  const totalAgreedAmountMinorUnits =
    input.principalAmountMinorUnits + input.feeAmountMinorUnits;
  const recordedRepayments = input.repaymentAmountsMinorUnits.reduce(
    (total, amount) => total + amount,
    0n,
  );
  const repaidAmountMinorUnits =
    recordedRepayments > totalAgreedAmountMinorUnits
      ? totalAgreedAmountMinorUnits
      : recordedRepayments;
  const remainingAmountMinorUnits =
    totalAgreedAmountMinorUnits - repaidAmountMinorUnits;
  const progressBasisPoints =
    totalAgreedAmountMinorUnits === 0n
      ? 0
      : Number(
          (repaidAmountMinorUnits * 10_000n) / totalAgreedAmountMinorUnits,
        );

  return {
    totalAgreedAmountMinorUnits,
    repaidAmountMinorUnits,
    remainingAmountMinorUnits,
    progressBasisPoints,
  };
}
