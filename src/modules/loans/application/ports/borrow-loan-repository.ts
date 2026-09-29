import type {
  BorrowableOffer,
  BorrowLoanCommand,
  CreatedBorrowingLoan,
} from "@/modules/loans/domain/borrow-loan";
import type { PolicyViolation } from "@/modules/policies/domain/lending-policy";

export type BorrowLoanRepositoryResult =
  | Readonly<{
      kind: "CREATED" | "ALREADY_CREATED";
      loan: CreatedBorrowingLoan;
    }>
  | Readonly<{ kind: "OFFER_NOT_AVAILABLE" }>
  | Readonly<{ kind: "AMOUNT_OUT_OF_RANGE" }>
  | Readonly<{ kind: "INSUFFICIENT_LIQUIDITY" }>
  | Readonly<{ kind: "INSUFFICIENT_LENDER_BALANCE" }>
  | Readonly<{ kind: "POLICY_VIOLATION"; violation: PolicyViolation }>
  | Readonly<{ kind: "REQUEST_CONFLICT" }>;

export interface BorrowLoanRepository {
  findBorrowableOffer(input: {
    organizationId: string;
    userId: string;
    offerId: string;
    now: Date;
  }): Promise<BorrowableOffer | null>;

  createFromOffer(input: {
    organizationId: string;
    userId: string;
    command: BorrowLoanCommand;
    now: Date;
  }): Promise<BorrowLoanRepositoryResult>;
}
