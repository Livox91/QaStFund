import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import type { LoanQueryRepository } from "@/modules/loans/application/ports/loan-query-repository";
import type { LoanView } from "@/modules/loans/domain/loan-query";

const loanSelection = {
  id: true,
  lendingOfferId: true,
  principalAmountMinorUnits: true,
  feeAmountMinorUnits: true,
  currency: true,
  durationDays: true,
  feeRateBasisPoints: true,
  status: true,
  createdAt: true,
  activatedAt: true,
  closedAt: true,
  repaymentDueAt: true,
  lenderMembership: {
    select: { user: { select: { id: true, name: true } } },
  },
  borrowerMembership: {
    select: { user: { select: { id: true, name: true } } },
  },
  repayments: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      amountMinorUnits: true,
      currency: true,
      status: true,
      createdAt: true,
      completedAt: true,
    },
  },
} as const;

type LoanRow = {
  id: string;
  lendingOfferId: string | null;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  currency: string;
  durationDays: number;
  feeRateBasisPoints: number;
  status: LoanView["status"];
  createdAt: Date;
  activatedAt: Date | null;
  closedAt: Date | null;
  repaymentDueAt: Date;
  lenderMembership: { user: { id: string; name: string } };
  borrowerMembership: { user: { id: string; name: string } };
  repayments: LoanView["repayments"];
};

function toLoanView(loan: LoanRow): LoanView {
  const repaymentAmountMinorUnits =
    loan.principalAmountMinorUnits + loan.feeAmountMinorUnits;
  const totalRepaidMinorUnits = loan.repayments
    .filter(({ status }) => status === "COMPLETED")
    .reduce((total, repayment) => total + repayment.amountMinorUnits, 0n);
  const remainingBalanceMinorUnits =
    totalRepaidMinorUnits < repaymentAmountMinorUnits
      ? repaymentAmountMinorUnits - totalRepaidMinorUnits
      : 0n;

  return {
    id: loan.id,
    offerId: loan.lendingOfferId,
    principalAmountMinorUnits: loan.principalAmountMinorUnits,
    interestAmountMinorUnits: loan.feeAmountMinorUnits,
    repaymentAmountMinorUnits,
    totalRepaidMinorUnits,
    remainingBalanceMinorUnits,
    currency: loan.currency,
    termDays: loan.durationDays,
    interestRateBasisPoints: loan.feeRateBasisPoints,
    status: loan.status,
    createdAt: loan.createdAt,
    activatedAt: loan.activatedAt,
    dueAt: loan.repaymentDueAt,
    repaidAt: loan.status === "REPAID" ? loan.closedAt : null,
    lender: loan.lenderMembership.user,
    borrower: loan.borrowerMembership.user,
    repayments: loan.repayments,
  };
}

async function findEmployeeMembership(organizationId: string, userId: string) {
  return prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true, isActive: true, role: true },
  });
}

export const prismaLoanQueryRepository: LoanQueryRepository = {
  async listBorrowed({ organizationId, userId }) {
    const membership = await findEmployeeMembership(organizationId, userId);
    if (!membership?.isActive || membership.role !== MembershipRole.EMPLOYEE) {
      return null;
    }

    const loans = await prisma.loan.findMany({
      where: { organizationId, borrowerMembershipId: membership.id },
      orderBy: { createdAt: "desc" },
      select: loanSelection,
    });
    return (loans as LoanRow[]).map(toLoanView);
  },

  async listFunded({ organizationId, userId }) {
    const membership = await findEmployeeMembership(organizationId, userId);
    if (!membership?.isActive || membership.role !== MembershipRole.EMPLOYEE) {
      return null;
    }

    const loans = await prisma.loan.findMany({
      where: { organizationId, lenderMembershipId: membership.id },
      orderBy: { createdAt: "desc" },
      select: loanSelection,
    });
    return (loans as LoanRow[]).map(toLoanView);
  },

  async findAccessible({ loanId, organizationId, role, userId }) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, isActive: true, role: true },
    });
    if (!membership?.isActive || membership.role !== role) return null;
    if (
      role !== ApplicationRole.EMPLOYEE &&
      role !== ApplicationRole.EMPLOYER_ADMIN
    ) {
      return null;
    }

    const participationScope =
      role === ApplicationRole.EMPLOYEE
        ? {
            OR: [
              { borrowerMembershipId: membership.id },
              { lenderMembershipId: membership.id },
            ],
          }
        : {};

    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
        ...participationScope,
      },
      select: loanSelection,
    });

    return loan ? toLoanView(loan as LoanRow) : null;
  },
};
