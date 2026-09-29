import type {
  BorrowLoanQuote,
  CreatedBorrowingLoan,
} from "@/modules/loans/domain/borrow-loan";
import type { RecordedLoanRepayment } from "@/modules/loans/domain/employee-loan";
import type { LoanView } from "@/modules/loans/domain/loan-query";

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

export function toBorrowQuoteResponse(quote: BorrowLoanQuote) {
  return {
    principalAmount: formatMinorUnits(quote.principalAmountMinorUnits),
    interestRate: formatBasisPoints(quote.feeRateBasisPoints),
    interestAmount: formatMinorUnits(quote.feeAmountMinorUnits),
    repaymentAmount: formatMinorUnits(quote.totalRepaymentMinorUnits),
    currency: quote.currency,
    termDays: quote.durationDays,
    estimatedDueDate: quote.repaymentDueAt.toISOString(),
  } as const;
}

export function toCreatedLoanResponse(loan: CreatedBorrowingLoan) {
  return {
    id: loan.id,
    offerId: loan.offerId,
    principalAmount: formatMinorUnits(loan.principalAmountMinorUnits),
    interestRate: formatBasisPoints(loan.feeRateBasisPoints),
    interestAmount: formatMinorUnits(loan.feeAmountMinorUnits),
    repaymentAmount: formatMinorUnits(loan.totalRepaymentMinorUnits),
    currency: loan.currency,
    termDays: loan.durationDays,
    status: "ACTIVE" as const,
    activatedAt: loan.activatedAt.toISOString(),
    dueAt: loan.repaymentDueAt.toISOString(),
  } as const;
}

export function toLoanResponse(loan: LoanView) {
  return {
    id: loan.id,
    offerId: loan.offerId,
    principalAmount: formatMinorUnits(loan.principalAmountMinorUnits),
    interestRate: formatBasisPoints(loan.interestRateBasisPoints),
    interestAmount: formatMinorUnits(loan.interestAmountMinorUnits),
    repaymentAmount: formatMinorUnits(loan.repaymentAmountMinorUnits),
    totalRepaid: formatMinorUnits(loan.totalRepaidMinorUnits),
    remainingBalance: formatMinorUnits(loan.remainingBalanceMinorUnits),
    currency: loan.currency,
    termDays: loan.termDays,
    status: loan.status,
    createdAt: loan.createdAt.toISOString(),
    activatedAt: loan.activatedAt?.toISOString() ?? null,
    dueAt: loan.dueAt.toISOString(),
    repaidAt: loan.repaidAt?.toISOString() ?? null,
    lender: loan.lender,
    borrower: loan.borrower,
    repayments: loan.repayments.map(toRepaymentResponse),
  } as const;
}

export function toRepaymentResponse(repayment: LoanView["repayments"][number]) {
  return {
    id: repayment.id,
    amount: formatMinorUnits(repayment.amountMinorUnits),
    currency: repayment.currency,
    status: repayment.status,
    createdAt: repayment.createdAt.toISOString(),
    completedAt: repayment.completedAt?.toISOString() ?? null,
  } as const;
}

export function toRecordedRepaymentResponse(repayment: RecordedLoanRepayment) {
  return {
    id: repayment.id,
    loanId: repayment.loanId,
    amount: formatMinorUnits(repayment.amountMinorUnits),
    currency: repayment.currency,
    status: "COMPLETED" as const,
    completedAt: repayment.completedAt.toISOString(),
    loanStatus: repayment.loanStatus,
  } as const;
}
