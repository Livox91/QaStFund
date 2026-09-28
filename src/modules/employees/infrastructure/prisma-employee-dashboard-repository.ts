import { LoanStatus, MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type {
  EmployeeDashboardActivityRecord,
  EmployeeDashboardLoanRecord,
  EmployeeDashboardRepository,
} from "@/modules/employees/application/ports/employee-dashboard-repository";

const CURRENT_LOAN_STATUSES = [LoanStatus.ACTIVE, LoanStatus.OVERDUE] as const;

type CurrentLoanRow = {
  id: string;
  lenderMembershipId: string;
  borrowerMembershipId: string;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  outstandingPrincipalMinorUnits: bigint;
  currency: string;
  status: EmployeeDashboardLoanRecord["status"];
  repaymentDueAt: Date;
  lenderMembership: { user: { name: string } };
  borrowerMembership: { user: { name: string } };
  repayments: Array<{ amountMinorUnits: bigint }>;
};

type ActivityRow = {
  id: string;
  title: string;
  occurredAt: Date;
  loan: {
    lenderMembershipId: string;
    borrowerMembershipId: string;
    lenderMembership: { user: { name: string } };
    borrowerMembership: { user: { name: string } };
  };
};

function toLoanRecord(
  loan: CurrentLoanRow,
  membershipId: string,
): EmployeeDashboardLoanRecord {
  const isBorrowing = loan.borrowerMembershipId === membershipId;

  return {
    id: loan.id,
    counterpartyName: isBorrowing
      ? loan.lenderMembership.user.name
      : loan.borrowerMembership.user.name,
    participation: isBorrowing ? "BORROWING" : "LENDING",
    principalAmountMinorUnits: loan.principalAmountMinorUnits,
    feeAmountMinorUnits: loan.feeAmountMinorUnits,
    outstandingPrincipalMinorUnits: loan.outstandingPrincipalMinorUnits,
    currency: loan.currency,
    status: loan.status,
    repaymentDueAt: loan.repaymentDueAt,
    repayments: loan.repayments,
  };
}

function toActivityRecord(
  activity: ActivityRow,
  membershipId: string,
): EmployeeDashboardActivityRecord {
  const isBorrowing = activity.loan.borrowerMembershipId === membershipId;

  return {
    id: activity.id,
    title: activity.title,
    participation: isBorrowing ? "BORROWING" : "LENDING",
    counterpartyName: isBorrowing
      ? activity.loan.lenderMembership.user.name
      : activity.loan.borrowerMembership.user.name,
    occurredAt: activity.occurredAt,
  };
}

const participantSelection = {
  lenderMembershipId: true,
  borrowerMembershipId: true,
  lenderMembership: { select: { user: { select: { name: true } } } },
  borrowerMembership: { select: { user: { select: { name: true } } } },
} as const;

export const prismaEmployeeDashboardRepository: EmployeeDashboardRepository = {
  async loadForEmployee({ now, organizationId, userId }) {
    return prisma.$transaction(async (transaction) => {
      const membership = await transaction.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { id: true, isActive: true, role: true },
      });

      if (
        !membership?.isActive ||
        membership.role !== MembershipRole.EMPLOYEE
      ) {
        return null;
      }

      const organization = await transaction.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { currency: true },
      });
      const employeeScope = {
        organizationId,
        currency: organization.currency,
      };
      const balance = await transaction.employeeBalance.findUnique({
        where: {
          organizationId_membershipId: {
            organizationId,
            membershipId: membership.id,
          },
        },
        select: { amountMinorUnits: true },
      });
      const committedBalance = await transaction.lendingOffer.aggregate({
        where: {
          ...employeeScope,
          lenderMembershipId: membership.id,
          status: "ACTIVE",
          expiresAt: { gt: now },
        },
        _sum: { availableAmountMinorUnits: true },
      });
      const earnings = await transaction.loan.aggregate({
        where: {
          ...employeeScope,
          lenderMembershipId: membership.id,
          status: "REPAID",
        },
        _sum: { feeAmountMinorUnits: true },
      });
      const currentLoans = await transaction.loan.findMany({
        where: {
          ...employeeScope,
          status: { in: [...CURRENT_LOAN_STATUSES] },
          outstandingPrincipalMinorUnits: { gt: 0n },
          OR: [
            { lenderMembershipId: membership.id },
            { borrowerMembershipId: membership.id },
          ],
        },
        orderBy: { repaymentDueAt: "asc" },
        select: {
          id: true,
          ...participantSelection,
          principalAmountMinorUnits: true,
          feeAmountMinorUnits: true,
          outstandingPrincipalMinorUnits: true,
          currency: true,
          status: true,
          repaymentDueAt: true,
          repayments: {
            select: { amountMinorUnits: true },
            orderBy: { paidAt: "asc" },
          },
        },
      });
      const recentActivity = await transaction.auditEvent.findMany({
        where: {
          organizationId,
          loan: {
            OR: [
              { lenderMembershipId: membership.id },
              { borrowerMembershipId: membership.id },
            ],
          },
        },
        orderBy: { occurredAt: "desc" },
        take: 8,
        select: {
          id: true,
          title: true,
          occurredAt: true,
          loan: { select: participantSelection },
        },
      });

      return {
        currency: organization.currency,
        availableBalanceMinorUnits:
          (balance?.amountMinorUnits ?? 0n) >
          (committedBalance._sum.availableAmountMinorUnits ?? 0n)
            ? (balance?.amountMinorUnits ?? 0n) -
              (committedBalance._sum.availableAmountMinorUnits ?? 0n)
            : 0n,
        totalEarningsMinorUnits: earnings._sum.feeAmountMinorUnits ?? 0n,
        currentLoans: (currentLoans as CurrentLoanRow[]).map((loan) =>
          toLoanRecord(loan, membership.id),
        ),
        recentActivity: (recentActivity as ActivityRow[]).map((activity) =>
          toActivityRecord(activity, membership.id),
        ),
      };
    });
  },
};
