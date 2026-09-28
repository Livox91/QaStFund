import type {
  EmployerLoanAuditEvent,
  EmployerLoanRepayment,
  EmployerLoanStatus,
} from "@/modules/loans/domain/employer-loan";

export type EmployerLoanRecord = Readonly<{
  id: string;
  borrowerName: string;
  lenderName: string;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  currency: string;
  status: EmployerLoanStatus;
  startedAt: Date;
  repaymentDueAt: Date;
  repayments: ReadonlyArray<EmployerLoanRepayment>;
}>;

export type EmployerLoanDetailsRecord = EmployerLoanRecord &
  Readonly<{ auditEvents: ReadonlyArray<EmployerLoanAuditEvent> }>;

export interface EmployerLoanRepository {
  listForOrganization(input: {
    organizationId: string;
    status?: EmployerLoanStatus;
  }): Promise<ReadonlyArray<EmployerLoanRecord>>;

  findDetailsForOrganization(input: {
    loanId: string;
    organizationId: string;
  }): Promise<EmployerLoanDetailsRecord | null>;
}
