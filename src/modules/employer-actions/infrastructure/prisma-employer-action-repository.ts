import { MembershipRole, type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import type { EmployerActionRepository } from "@/modules/employer-actions/application/ports/employer-action-repository";
import type {
  EmployerActionAttempt,
  EmployerActionProvider,
  EmployerActionStatus,
  EmployerActionType,
} from "@/modules/employer-actions/domain/employer-action";
import type { LoanDecisionClassification } from "@/modules/loan-decisions/domain/loan-decision";

const attemptSelection = {
  id: true,
  loanId: true,
  action: true,
  status: true,
  provider: true,
  idempotencyKey: true,
  adapterActionId: true,
  messageCode: true,
  requestedAt: true,
  completedAt: true,
  requestedByMembership: {
    select: { user: { select: { id: true, name: true } } },
  },
} as const;

type AttemptRow = Prisma.EmployerActionAttemptGetPayload<{
  select: typeof attemptSelection;
}>;

function toAttempt(row: AttemptRow): EmployerActionAttempt {
  return {
    id: row.id,
    loanId: row.loanId,
    action: row.action.toLowerCase() as EmployerActionType,
    status: row.status.toLowerCase() as EmployerActionStatus,
    provider: row.provider.toLowerCase() as EmployerActionProvider,
    idempotencyKey: row.idempotencyKey,
    adapterActionId: row.adapterActionId,
    messageCode: row.messageCode,
    requestedByUserId: row.requestedByMembership.user.id,
    requestedByName: row.requestedByMembership.user.name,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
  };
}

async function findAuthorizedMembership(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  userId: string,
) {
  const membership = await client.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true, isActive: true, role: true },
  });
  return membership?.isActive &&
    membership.role === MembershipRole.EMPLOYER_ADMIN
    ? membership
    : null;
}

export const prismaEmployerActionRepository: EmployerActionRepository = {
  async findContext({ organizationId, loanId, requestedByUserId }) {
    const membership = await findAuthorizedMembership(
      prisma,
      organizationId,
      requestedByUserId,
    );
    if (!membership) return null;

    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
        status: { in: ["ACTIVE", "OVERDUE"] },
      },
      select: {
        status: true,
        decisionEvaluations: {
          orderBy: { evaluatedAt: "desc" },
          take: 1,
          select: {
            id: true,
            classification: true,
            reviews: {
              orderBy: { reviewedAt: "desc" },
              take: 1,
              select: { reviewedAt: true },
            },
          },
        },
      },
    });
    const evaluation = loan?.decisionEvaluations[0];
    if (!loan || !evaluation) return null;
    return {
      evaluationId: evaluation.id,
      classification:
        evaluation.classification.toLowerCase() as LoanDecisionClassification,
      financialStatus: loan.status,
      reviewedAt: evaluation.reviews[0]?.reviewedAt ?? null,
    };
  },

  async findByIdempotencyKey({
    organizationId,
    idempotencyKey,
    requestedByUserId,
  }) {
    const membership = await findAuthorizedMembership(
      prisma,
      organizationId,
      requestedByUserId,
    );
    if (!membership) return null;
    const attempt = await prisma.employerActionAttempt.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey },
      },
      select: attemptSelection,
    });
    return attempt ? toAttempt(attempt) : null;
  },

  async claimAttempt(input) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`employer-action:${input.organizationId}:${input.idempotencyKey}`}, 0))
      `;
      const existing = await transaction.employerActionAttempt.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: input.organizationId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: attemptSelection,
      });
      if (existing) return { kind: "EXISTING", attempt: toAttempt(existing) };

      const membership = await findAuthorizedMembership(
        transaction,
        input.organizationId,
        input.requestedByUserId,
      );
      if (!membership) return null;
      const loan = await transaction.loan.findFirst({
        where: {
          id: input.loanId,
          organizationId: input.organizationId,
          status: { in: ["ACTIVE", "OVERDUE"] },
        },
        select: {
          id: true,
          decisionEvaluations: {
            orderBy: { evaluatedAt: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      });
      if (!loan || loan.decisionEvaluations[0]?.id !== input.evaluationId) {
        return null;
      }

      const attempt = await transaction.employerActionAttempt.create({
        data: {
          organizationId: input.organizationId,
          loanId: input.loanId,
          evaluationId: input.evaluationId,
          requestedByMembershipId: membership.id,
          action: input.action.toUpperCase() as
            | "MARK_REVIEWED"
            | "REQUEST_EMPLOYEE_CONTACT"
            | "REQUEST_HR_FOLLOW_UP",
          status: "PENDING",
          provider: input.provider.toUpperCase() as "MOCK",
          idempotencyKey: input.idempotencyKey,
          messageCode: "ACTION_PENDING",
          requestedAt: input.requestedAt,
        },
        select: attemptSelection,
      });
      return { kind: "CLAIMED", attempt: toAttempt(attempt) };
    });
  },

  async completeAttempt({ organizationId, attemptId, result, completedAt }) {
    return prisma.$transaction(async (transaction) => {
      const attempt = await transaction.employerActionAttempt.findFirstOrThrow({
        where: { id: attemptId, organizationId },
        select: {
          id: true,
          status: true,
          action: true,
          evaluationId: true,
          loanId: true,
          requestedByMembershipId: true,
        },
      });
      if (attempt.status !== "PENDING") {
        const existing =
          await transaction.employerActionAttempt.findUniqueOrThrow({
            where: { id: attempt.id },
            select: attemptSelection,
          });
        return toAttempt(existing);
      }

      const updated = await transaction.employerActionAttempt.update({
        where: { id: attempt.id },
        data: {
          status: result.status.toUpperCase() as
            "COMPLETED" | "PENDING" | "REJECTED" | "FAILED",
          adapterActionId: result.actionId,
          messageCode: result.messageCode,
          completedAt: result.status === "pending" ? null : completedAt,
        },
        select: attemptSelection,
      });
      if (attempt.action === "MARK_REVIEWED" && result.status === "completed") {
        await transaction.loanDecisionReview.upsert({
          where: {
            evaluationId_reviewedByMembershipId: {
              evaluationId: attempt.evaluationId,
              reviewedByMembershipId: attempt.requestedByMembershipId,
            },
          },
          create: {
            organizationId,
            loanId: attempt.loanId,
            evaluationId: attempt.evaluationId,
            reviewedByMembershipId: attempt.requestedByMembershipId,
            reviewedAt: completedAt,
          },
          update: {},
        });
      }
      return toAttempt(updated);
    });
  },

  async listForLoan({ organizationId, loanId, requestedByUserId }) {
    const membership = await findAuthorizedMembership(
      prisma,
      organizationId,
      requestedByUserId,
    );
    if (!membership) return null;
    const loan = await prisma.loan.findFirst({
      where: { id: loanId, organizationId },
      select: { id: true },
    });
    if (!loan) return null;
    const attempts = await prisma.employerActionAttempt.findMany({
      where: { organizationId, loanId },
      orderBy: { requestedAt: "desc" },
      select: attemptSelection,
    });
    return attempts.map(toAttempt);
  },
};
