import { prisma } from "@/infrastructure/database/prisma";
import type {
  EmployerLoanDetailsRecord,
  EmployerLoanRecord,
  EmployerLoanRepository,
} from "@/modules/loans/application/ports/employer-loan-repository";

type PrismaLoanRow = {
  id: string;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  currency: string;
  status: EmployerLoanRecord["status"];
  startedAt: Date;
  repaymentDueAt: Date;
  lenderMembership: { user: { name: string } };
  borrowerMembership: { user: { name: string } };
  repayments: Array<{
    id: string;
    amountMinorUnits: bigint;
    currency: string;
    paidAt: Date;
  }>;
};

type PrismaLoanDetailsRow = PrismaLoanRow & {
  auditEvents: Array<{
    id: string;
    type: EmployerLoanDetailsRecord["auditEvents"][number]["type"];
    title: string;
    actorLabel: string | null;
    occurredAt: Date;
  }>;
};

const baseLoanSelection = {
  id: true,
  principalAmountMinorUnits: true,
  feeAmountMinorUnits: true,
  currency: true,
  status: true,
  startedAt: true,
  repaymentDueAt: true,
  lenderMembership: { select: { user: { select: { name: true } } } },
  borrowerMembership: { select: { user: { select: { name: true } } } },
  repayments: {
    where: { status: "COMPLETED" as const },
    orderBy: { paidAt: "asc" as const },
    select: {
      id: true,
      amountMinorUnits: true,
      currency: true,
      paidAt: true,
    },
  },
} as const;

function toLoanRecord(loan: PrismaLoanRow): EmployerLoanRecord {
  return {
    id: loan.id,
    borrowerName: loan.borrowerMembership.user.name,
    lenderName: loan.lenderMembership.user.name,
    principalAmountMinorUnits: loan.principalAmountMinorUnits,
    feeAmountMinorUnits: loan.feeAmountMinorUnits,
    currency: loan.currency,
    status: loan.status,
    startedAt: loan.startedAt,
    repaymentDueAt: loan.repaymentDueAt,
    repayments: loan.repayments,
  };
}

export const prismaEmployerLoanRepository: EmployerLoanRepository = {
  async listForOrganization({ organizationId, status }) {
    const loans = await prisma.loan.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { startedAt: "desc" },
      select: baseLoanSelection,
    });

    return loans.map(toLoanRecord);
  },

  async findDetailsForOrganization({ organizationId, loanId }) {
    const loan = await prisma.loan.findFirst({
      where: { id: loanId, organizationId },
      select: {
        ...baseLoanSelection,
        auditEvents: {
          orderBy: { occurredAt: "desc" },
          select: {
            id: true,
            type: true,
            title: true,
            actorLabel: true,
            occurredAt: true,
          },
        },
      },
    });

    if (!loan) return null;

    const details = loan as PrismaLoanDetailsRow;

    return {
      ...toLoanRecord(details),
      auditEvents: details.auditEvents,
    };
  },
};
