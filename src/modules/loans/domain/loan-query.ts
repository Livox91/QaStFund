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
