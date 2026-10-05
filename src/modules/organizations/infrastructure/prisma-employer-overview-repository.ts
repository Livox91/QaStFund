import { LoanStatus } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type {
  EmployerOverviewRepository,
  EmployerOverviewRepositoryResult,
} from "@/modules/organizations/application/ports/employer-overview-repository";
import type { EmployerOverviewLoan } from "@/modules/organizations/domain/employer-overview";

const ACTIVE_LOAN_STATUSES = [LoanStatus.ACTIVE, LoanStatus.OVERDUE] as const;

type LoanRow = {
  id: string;
  principalAmountMinorUnits: bigint;
  outstandingPrincipalMinorUnits: bigint;
  currency: string;
  status: (typeof LoanStatus)[keyof typeof LoanStatus];
  repaymentDueAt: Date;
  updatedAt: Date;
  lenderMembership: { user: { name: string } };
  borrowerMembership: { user: { name: string } };
};

function toOverviewLoan(loan: LoanRow): EmployerOverviewLoan {
  return {
    id: loan.id,
    borrowerName: loan.borrowerMembership.user.name,
    lenderName: loan.lenderMembership.user.name,
    principalAmountMinorUnits: loan.principalAmountMinorUnits,
    outstandingPrincipalMinorUnits: loan.outstandingPrincipalMinorUnits,
    currency: loan.currency,
    status: loan.status,
    repaymentDueAt: loan.repaymentDueAt,
    updatedAt: loan.updatedAt,
  };
}

const loanSummarySelection = {
  id: true,
  principalAmountMinorUnits: true,
  outstandingPrincipalMinorUnits: true,
  currency: true,
  status: true,
  repaymentDueAt: true,
  updatedAt: true,
  lenderMembership: { select: { user: { select: { name: true } } } },
  borrowerMembership: { select: { user: { select: { name: true } } } },
} as const;

export const prismaEmployerOverviewRepository: EmployerOverviewRepository = {
  async loadForOrganization({
    attentionWindowEndsAt,
    dueWindowEndsAt,
    now,
    organizationId,
  }): Promise<EmployerOverviewRepositoryResult> {
    return prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { currency: true },
      });

      const currency = organization.currency;
      const tenantCurrency = { organizationId, currency };
      const totalEmployees = await transaction.organizationMembership.count({
        where: { organizationId, role: "EMPLOYEE", isActive: true },
      });
      const activeOfferLenders = await transaction.lendingOffer.findMany({
        where: {
          ...tenantCurrency,
          status: "ACTIVE",
          availableAmountMinorUnits: { gt: 0n },
          lenderMembership: { isActive: true, role: "EMPLOYEE" },
        },
        distinct: ["lenderMembershipId"],
        select: { lenderMembershipId: true },
      });
      const activeLoanLenders = await transaction.loan.findMany({
        where: {
          ...tenantCurrency,
          status: { in: [...ACTIVE_LOAN_STATUSES] },
          outstandingPrincipalMinorUnits: { gt: 0n },
          lenderMembership: { isActive: true, role: "EMPLOYEE" },
        },
        distinct: ["lenderMembershipId"],
        select: { lenderMembershipId: true },
      });
      const activeBorrowers = await transaction.loan.findMany({
        where: {
          ...tenantCurrency,
          status: { in: [...ACTIVE_LOAN_STATUSES] },
          outstandingPrincipalMinorUnits: { gt: 0n },
          borrowerMembership: { isActive: true, role: "EMPLOYEE" },
        },
        distinct: ["borrowerMembershipId"],
        select: { borrowerMembershipId: true },
      });
      const availableLiquidity = await transaction.lendingOffer.aggregate({
        where: {
          ...tenantCurrency,
          status: "ACTIVE",
          availableAmountMinorUnits: { gt: 0n },
          lenderMembership: { isActive: true, role: "EMPLOYEE" },
        },
        _sum: { availableAmountMinorUnits: true },
      });
      const outstandingPrincipal = await transaction.loan.aggregate({
        where: {
          ...tenantCurrency,
          status: { in: [...ACTIVE_LOAN_STATUSES] },
          outstandingPrincipalMinorUnits: { gt: 0n },
        },
        _sum: { outstandingPrincipalMinorUnits: true },
      });
      const repaymentsDue = await transaction.loan.count({
        where: {
          ...tenantCurrency,
          status: "ACTIVE",
          outstandingPrincipalMinorUnits: { gt: 0n },
          repaymentDueAt: { gte: now, lte: dueWindowEndsAt },
        },
      });
      const overdueLoans = await transaction.loan.count({
        where: {
          ...tenantCurrency,
          status: "OVERDUE",
          outstandingPrincipalMinorUnits: { gt: 0n },
        },
      });
      const recentLoans = await transaction.loan.findMany({
        where: tenantCurrency,
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: loanSummarySelection,
      });
      const attentionLoans = await transaction.loan.findMany({
        where: {
          ...tenantCurrency,
          outstandingPrincipalMinorUnits: { gt: 0n },
          OR: [
            { status: "OVERDUE" },
            {
              status: "ACTIVE",
              repaymentDueAt: { gte: now, lte: attentionWindowEndsAt },
            },
          ],
        },
        orderBy: { repaymentDueAt: "asc" },
        take: 5,
        select: loanSummarySelection,
      });

      const lendingEmployeeIds = new Set([
        ...activeOfferLenders.map((offer) => offer.lenderMembershipId),
        ...activeLoanLenders.map((loan) => loan.lenderMembershipId),
      ]);

      return {
        currency,
        metrics: {
          totalEmployees,
          employeesCurrentlyLending: lendingEmployeeIds.size,
          employeesCurrentlyBorrowing: activeBorrowers.length,
          availableLiquidityMinorUnits:
            availableLiquidity._sum.availableAmountMinorUnits ?? 0n,
          outstandingPrincipalMinorUnits:
            outstandingPrincipal._sum.outstandingPrincipalMinorUnits ?? 0n,
          repaymentsDue,
          overdueLoans,
        },
        recentLoanActivity: recentLoans.map(toOverviewLoan),
        loansRequiringAttention: attentionLoans.map(toOverviewLoan),
      };
    });
  },
};
