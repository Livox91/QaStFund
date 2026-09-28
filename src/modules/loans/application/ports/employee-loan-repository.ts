import type {
  EmployeeBorrowedLoanRecord,
  RecordedLoanRepayment,
  RepayLoanCommand,
} from "@/modules/loans/domain/employee-loan";

export type RepayLoanRepositoryResult =
  | Readonly<{
      kind: "RECORDED" | "ALREADY_RECORDED";
      repayment: RecordedLoanRepayment;
    }>
  | Readonly<{ kind: "LOAN_NOT_FOUND" }>
  | Readonly<{ kind: "LOAN_NOT_REPAYABLE" }>
  | Readonly<{ kind: "AMOUNT_EXCEEDS_REMAINING" }>
  | Readonly<{ kind: "INSUFFICIENT_BALANCE" }>
  | Readonly<{ kind: "BALANCE_UNAVAILABLE" }>
  | Readonly<{ kind: "REQUEST_CONFLICT" }>;

export interface EmployeeLoanRepository {
  findBorrowedLoan(input: {
    organizationId: string;
    userId: string;
    loanId: string;
  }): Promise<EmployeeBorrowedLoanRecord | null>;

  repayBorrowedLoan(input: {
    organizationId: string;
    userId: string;
    command: RepayLoanCommand;
    now: Date;
  }): Promise<RepayLoanRepositoryResult>;
}
