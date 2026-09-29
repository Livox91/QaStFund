import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type { LoanLifecycleRepository } from "@/modules/loans/application/ports/loan-lifecycle-repository";

export const prismaLoanLifecycleRepository: LoanLifecycleRepository = {
  async markOverdue({ organizationId, actorUserId, now }) {
    return prisma.$transaction(async (transaction) => {
      const actorMembership =
        await transaction.organizationMembership.findUnique({
          where: {
            organizationId_userId: { organizationId, userId: actorUserId },
          },
          select: {
            id: true,
            isActive: true,
            role: true,
            user: { select: { name: true } },
          },
        });
      if (
        !actorMembership?.isActive ||
        actorMembership.role !== MembershipRole.EMPLOYER_ADMIN
      ) {
        return 0;
      }

      const overdueLoans = await transaction.$queryRaw<Array<{ id: string }>>`
        UPDATE "Loan" AS loan
        SET "status" = 'OVERDUE', "updatedAt" = ${now}
        WHERE loan."organizationId" = CAST(${organizationId} AS UUID)
          AND loan."status" = 'ACTIVE'
          AND loan."repaymentDueAt" < ${now}
          AND (loan."principalAmountMinorUnits" + loan."feeAmountMinorUnits") > COALESCE((
            SELECT SUM(repayment."amountMinorUnits")
            FROM "LoanRepayment" AS repayment
            WHERE repayment."organizationId" = loan."organizationId"
              AND repayment."loanId" = loan."id"
              AND repayment."status" = 'COMPLETED'
          ), 0)
        RETURNING loan."id"
      `;

      if (overdueLoans.length > 0) {
        await transaction.auditEvent.createMany({
          data: overdueLoans.map(({ id }) => ({
            organizationId,
            loanId: id,
            actorMembershipId: actorMembership.id,
            type: "LOAN_MARKED_OVERDUE" as const,
            title: "Loan marked overdue",
            actorLabel: actorMembership.user.name,
            occurredAt: now,
          })),
        });
      }

      return overdueLoans.length;
    });
  },
};
