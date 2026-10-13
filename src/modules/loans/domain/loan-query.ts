import type { EmployerLoanStatus } from "@/modules/loans/domain/employer-loan";

export type LoanParticipant = Readonly<{ id: string; name: string }>;

export type LoanRepaymentView = Readonly<{
  id: string;
  amountMinorUnits: bigint;
  currency: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  createdAt: Date;
  completedAt: Date | null;
}>;

export type LoanView = Readonly<{
  id: string;
  offerId: string | null;
  principalAmountMinorUnits: bigint;
  interestAmountMinorUnits: bigint;
  repaymentAmountMinorUnits: bigint;
  totalRepaidMinorUnits: bigint;
  remainingBalanceMinorUnits: bigint;
  currency: string;
  termDays: number;
  interestRateBasisPoints: number;
  status: EmployerLoanStatus;
  createdAt: Date;
  activatedAt: Date | null;
  dueAt: Date;
  repaidAt: Date | null;
  lender: LoanParticipant;
  borrower: LoanParticipant;
  repayments: ReadonlyArray<LoanRepaymentView>;
}>;

export type LenderLoanAmounts = Readonly<{
  pendingMinorUnits: bigint;
  approvedMinorUnits: bigint;
  reservedMinorUnits: bigint;
  disbursedMinorUnits: bigint;
  repaidMinorUnits: bigint;
  outstandingMinorUnits: bigint;
}>;

export function calculateLenderLoanAmounts(
  loan: Pick<
    LoanView,
    | "principalAmountMinorUnits"
    | "remainingBalanceMinorUnits"
    | "status"
    | "totalRepaidMinorUnits"
  >,
): LenderLoanAmounts {
  const isDisbursed = ["ACTIVE", "OVERDUE", "REPAID"].includes(loan.status);

  return {
    pendingMinorUnits:
      loan.status === "REQUESTED" ? loan.principalAmountMinorUnits : 0n,
    approvedMinorUnits:
      loan.status === "APPROVED" ? loan.principalAmountMinorUnits : 0n,
    // An approval does not reserve escrow capacity. Capacity moves only when
    // acceptance/disbursement is confirmed, so the current architecture has
    // no separate reserved-money state.
    reservedMinorUnits: 0n,
    disbursedMinorUnits: isDisbursed ? loan.principalAmountMinorUnits : 0n,
    repaidMinorUnits: loan.totalRepaidMinorUnits,
    outstandingMinorUnits: isDisbursed ? loan.remainingBalanceMinorUnits : 0n,
  };
}
