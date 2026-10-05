import { LoanStatus, MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type {
  EmployeeDashboardActivityRecord,
  EmployeeDashboardLoanRecord,
  EmployeeDashboardRepository,
} from "@/modules/employees/application/ports/employee-dashboard-repository";
import {
  ensureUserWallet,
  getCompletedAccountBalance,
} from "@/modules/ledger/infrastructure/ledger-posting";

const VISIBLE_LOAN_STATUSES = [
  LoanStatus.ACTIVE,
  LoanStatus.OVERDUE,
  LoanStatus.REPAID,
] as const;

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
  decisionEvaluations: Array<{ classification: string }>;
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
    riskClassification:
      (loan.decisionEvaluations[0]?.classification.toLowerCase() as
        "healthy" | "due_soon" | "overdue" | "default_candidate" | undefined) ??
      null,
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
  async loadForEmployee({ organizationId, userId }) {
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
      const wallet = await ensureUserWallet(transaction, {
        organizationId,
        membershipId: membership.id,
      });
      const availableBalanceMinorUnits = await getCompletedAccountBalance(
        transaction,
        { organizationId, accountId: wallet.id },
      );
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
          status: { in: [...VISIBLE_LOAN_STATUSES] },
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
            where: { status: "COMPLETED" },
            select: { amountMinorUnits: true },
            orderBy: { paidAt: "asc" },
          },
          decisionEvaluations: {
            orderBy: { evaluatedAt: "desc" },
            take: 1,
            select: { classification: true },
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
      const pendingBorrowing = await transaction.loan.findMany({
        where: {
          organizationId,
          borrowerMembershipId: membership.id,
          status: "REQUESTED",
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: { id: true, updatedAt: true },
      });
      const pendingRepayments = await transaction.loanRepayment.findMany({
        where: {
          organizationId,
          status: "PENDING",
          loan: { borrowerMembershipId: membership.id },
        },
        orderBy: { paidAt: "desc" },
        take: 8,
        select: { id: true, loanId: true, paidAt: true },
      });
      const pendingFunding = await transaction.lendingOffer.findMany({
        where: {
          organizationId,
          lenderMembershipId: membership.id,
          fundingStatus: "PENDING",
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: { id: true, updatedAt: true },
      });
      const pendingTransactions = [
        ...pendingBorrowing.map((loan) => ({
          id: `acceptance:${loan.id}`,
          kind: "loan_acceptance" as const,
          title: "Loan acceptance awaiting confirmation",
          href: "/app/borrow",
          startedAt: loan.updatedAt,
        })),
        ...pendingRepayments.map((repayment) => ({
          id: `repayment:${repayment.id}`,
          kind: "repayment" as const,
          title: "Repayment awaiting confirmation",
          href: `/app/loans/${repayment.loanId}`,
          startedAt: repayment.paidAt,
        })),
        ...pendingFunding.map((offer) => ({
          id: `funding:${offer.id}`,
          kind: "offer_funding" as const,
          title: "Offer funding awaiting confirmation",
          href: "/app/lending",
          startedAt: offer.updatedAt,
        })),
      ]
        .sort(
          (left, right) => right.startedAt.getTime() - left.startedAt.getTime(),
        )
        .slice(0, 8);

      return {
        currency: organization.currency,
        availableBalanceMinorUnits,
        totalEarningsMinorUnits: earnings._sum.feeAmountMinorUnits ?? 0n,
        currentLoans: (currentLoans as CurrentLoanRow[]).map((loan) =>
          toLoanRecord(loan, membership.id),
        ),
        recentActivity: (recentActivity as ActivityRow[]).map((activity) =>
          toActivityRecord(activity, membership.id),
        ),
        pendingTransactions,
      };
    });
  },
};
