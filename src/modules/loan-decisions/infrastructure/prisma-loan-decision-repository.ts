import { MembershipRole, type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import type {
  LoanDecisionCandidate,
  LoanDecisionEvaluationRecord,
  LoanDecisionRepository,
} from "@/modules/loan-decisions/application/ports/loan-decision-repository";
import type {
  LoanDecisionClassification,
  LoanDecisionReason,
  LoanDecisionRecommendedAction,
} from "@/modules/loan-decisions/domain/loan-decision";
import { USDC_BASE_UNITS_PER_CENT } from "@/shared/money/usdc";

const evaluationStatuses = [
  "ACTIVE",
  "OVERDUE",
  "REPAID",
  "DEFAULTED",
] as const;
const monitoringStatuses = ["ACTIVE", "OVERDUE"] as const;

const evaluationSelection = {
  id: true,
  loanId: true,
  classification: true,
  recommendedAction: true,
  reasonCodes: true,
  source: true,
  modelVersion: true,
  evaluatedAt: true,
  reviews: {
    orderBy: { reviewedAt: "desc" as const },
    take: 1,
    select: {
      reviewedAt: true,
      reviewedByMembership: { select: { user: { select: { name: true } } } },
    },
  },
} as const;

const monitoringSelection = {
  id: true,
  principalAmountMinorUnits: true,
  feeAmountMinorUnits: true,
  currency: true,
  status: true,
  repaymentDueAt: true,
  borrowerMembership: { select: { user: { select: { name: true } } } },
  lenderMembership: { select: { user: { select: { name: true } } } },
  repayments: {
    where: { status: "COMPLETED" as const },
    select: { amountMinorUnits: true },
  },
  decisionEvaluations: {
    orderBy: { evaluatedAt: "desc" as const },
    take: 1,
    select: evaluationSelection,
  },
  decisionReviews: {
    orderBy: { reviewedAt: "desc" as const },
    select: {
      id: true,
      reviewedAt: true,
      reviewedByMembership: { select: { user: { select: { name: true } } } },
      evaluation: { select: { classification: true } },
    },
  },
} as const;

type MonitoringRow = Prisma.LoanGetPayload<{
  select: typeof monitoringSelection;
}>;

function toEvaluation(
  evaluation: MonitoringRow["decisionEvaluations"][number],
): LoanDecisionEvaluationRecord {
  return {
    id: evaluation.id,
    loanId: evaluation.loanId,
    classification:
      evaluation.classification.toLowerCase() as LoanDecisionClassification,
    recommendedAction:
      evaluation.recommendedAction.toLowerCase() as LoanDecisionRecommendedAction,
    reasonCodes: evaluation.reasonCodes as LoanDecisionReason[],
    source: evaluation.source.toLowerCase() as "rules" | "model",
    modelVersion: evaluation.modelVersion,
    evaluatedAt: evaluation.evaluatedAt,
  };
}

function toMonitoring(row: MonitoringRow) {
  const evaluation = row.decisionEvaluations[0];
  if (!evaluation) return null;
  const review = evaluation.reviews[0];
  const totalAgreed = row.principalAmountMinorUnits + row.feeAmountMinorUnits;
  const repaid = row.repayments.reduce(
    (total, repayment) => total + repayment.amountMinorUnits,
    0n,
  );
  return {
    loanId: row.id,
    borrowerName: row.borrowerMembership.user.name,
    lenderName: row.lenderMembership.user.name,
    principalAmountMinorUnits: row.principalAmountMinorUnits,
    feeAmountMinorUnits: row.feeAmountMinorUnits,
    outstandingRepaymentMinorUnits:
      repaid < totalAgreed ? totalAgreed - repaid : 0n,
    currency: row.currency,
    dueAt: row.repaymentDueAt,
    financialStatus: row.status,
    evaluation: toEvaluation(evaluation),
    reviewedAt: review?.reviewedAt ?? null,
    reviewedByName: review?.reviewedByMembership.user.name ?? null,
    reviews: row.decisionReviews.map((item) => ({
      id: item.id,
      classification:
        item.evaluation.classification.toLowerCase() as LoanDecisionClassification,
      reviewedAt: item.reviewedAt,
      reviewedByName: item.reviewedByMembership.user.name,
    })),
  };
}

function toCandidate(row: {
  id: string;
  organizationId: string;
  principalBaseUnits: bigint | null;
  repaymentBaseUnits: bigint | null;
  principalAmountMinorUnits: bigint;
  feeAmountMinorUnits: bigint;
  startedAt: Date;
  repaymentDueAt: Date;
  status: string;
  borrowerMembership: { id: string; employmentStatus: string };
}): LoanDecisionCandidate {
  return {
    loanId: row.id,
    principalBaseUnits: (
      row.principalBaseUnits ??
      row.principalAmountMinorUnits * USDC_BASE_UNITS_PER_CENT
    ).toString(),
    repaymentBaseUnits: (
      row.repaymentBaseUnits ??
      (row.principalAmountMinorUnits + row.feeAmountMinorUnits) *
        USDC_BASE_UNITS_PER_CENT
    ).toString(),
    startedAt: row.startedAt,
    dueAt: row.repaymentDueAt,
    borrower: {
      employeeId: row.borrowerMembership.id,
      organizationId: row.organizationId,
      employmentStatus:
        row.borrowerMembership.employmentStatus.toLowerCase() as
          "active" | "suspended" | "terminated",
    },
    loanStatus: row.status.toLowerCase() as
      "active" | "repaid" | "overdue" | "defaulted",
  };
}

const candidateSelection = {
  id: true,
  organizationId: true,
  principalBaseUnits: true,
  repaymentBaseUnits: true,
  principalAmountMinorUnits: true,
  feeAmountMinorUnits: true,
  startedAt: true,
  repaymentDueAt: true,
  status: true,
  borrowerMembership: {
    select: { id: true, employmentStatus: true },
  },
} as const;

export const prismaLoanDecisionRepository: LoanDecisionRepository = {
  async listCandidates(organizationId) {
    const loans = await prisma.loan.findMany({
      where: { organizationId, status: { in: [...evaluationStatuses] } },
      select: candidateSelection,
    });
    return loans.map(toCandidate);
  },

  async listParticipantCandidates({ organizationId, userId }) {
    const loans = await prisma.loan.findMany({
      where: {
        organizationId,
        status: { in: [...evaluationStatuses] },
        OR: [
          {
            borrowerMembership: {
              userId,
              isActive: true,
              role: MembershipRole.EMPLOYEE,
            },
          },
          {
            lenderMembership: {
              userId,
              isActive: true,
              role: MembershipRole.EMPLOYEE,
            },
          },
        ],
      },
      select: candidateSelection,
    });
    return loans.map(toCandidate);
  },

  async findCandidate({ organizationId, loanId, borrowerUserId }) {
    const loan = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
        status: { in: [...evaluationStatuses] },
        ...(borrowerUserId
          ? {
              borrowerMembership: {
                userId: borrowerUserId,
                isActive: true,
                role: MembershipRole.EMPLOYEE,
              },
            }
          : {}),
      },
      select: candidateSelection,
    });
    return loan ? toCandidate(loan) : null;
  },

  async saveEvaluation({ organizationId, loanId, decision }) {
    return prisma.$transaction(async (transaction) => {
      // Serialize transition checks for one loan so concurrent page loads do
      // not append duplicate evaluations for an unchanged decision.
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${loanId}, 0))
      `;
      const latest = await transaction.loanDecisionEvaluation.findFirst({
        where: { organizationId, loanId },
        orderBy: { evaluatedAt: "desc" },
        select: evaluationSelection,
      });
      const unchanged =
        latest &&
        latest.classification === decision.classification.toUpperCase() &&
        latest.recommendedAction === decision.recommendedAction.toUpperCase() &&
        latest.source === decision.source.toUpperCase() &&
        latest.modelVersion === (decision.modelVersion ?? null) &&
        latest.reasonCodes.length === decision.reasonCodes.length &&
        latest.reasonCodes.every(
          (reason, index) => reason === decision.reasonCodes[index],
        );
      if (unchanged) return toEvaluation(latest);

      const created = await transaction.loanDecisionEvaluation.create({
        data: {
          organizationId,
          loanId,
          classification: decision.classification.toUpperCase() as
            "HEALTHY" | "DUE_SOON" | "OVERDUE" | "DEFAULT_CANDIDATE",
          recommendedAction: decision.recommendedAction.toUpperCase() as
            "NONE" | "REMIND" | "FLAG_FOR_REVIEW" | "EMPLOYER_REVIEW",
          reasonCodes: [...decision.reasonCodes],
          source: decision.source.toUpperCase() as "RULES" | "MODEL",
          modelVersion: decision.modelVersion,
          evaluatedAt: decision.evaluatedAt,
        },
        select: evaluationSelection,
      });
      return toEvaluation(created);
    });
  },

  async listMonitoring(organizationId) {
    const rows = await prisma.loan.findMany({
      where: { organizationId, status: { in: [...monitoringStatuses] } },
      orderBy: { repaymentDueAt: "asc" },
      select: monitoringSelection,
    });
    return rows.map(toMonitoring).filter((row) => row !== null);
  },

  async findMonitoring({ organizationId, loanId }) {
    const row = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
        status: { in: [...monitoringStatuses] },
      },
      select: monitoringSelection,
    });
    return row ? toMonitoring(row) : null;
  },

  async markReviewed({ organizationId, loanId, reviewedByUserId, reviewedAt }) {
    const marked = await prisma.$transaction(async (transaction) => {
      const reviewer = await transaction.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: reviewedByUserId,
          },
        },
        select: { id: true, isActive: true, role: true },
      });
      if (
        !reviewer?.isActive ||
        reviewer.role !== MembershipRole.EMPLOYER_ADMIN
      ) {
        return false;
      }
      const evaluation = await transaction.loanDecisionEvaluation.findFirst({
        where: { organizationId, loanId },
        orderBy: { evaluatedAt: "desc" },
        select: { id: true },
      });
      if (!evaluation) return false;

      await transaction.loanDecisionReview.upsert({
        where: {
          evaluationId_reviewedByMembershipId: {
            evaluationId: evaluation.id,
            reviewedByMembershipId: reviewer.id,
          },
        },
        create: {
          organizationId,
          loanId,
          evaluationId: evaluation.id,
          reviewedByMembershipId: reviewer.id,
          reviewedAt,
        },
        update: {},
      });
      return true;
    });
    if (!marked) return null;
    const row = await prisma.loan.findFirst({
      where: {
        id: loanId,
        organizationId,
        status: { in: [...monitoringStatuses] },
      },
      select: monitoringSelection,
    });
    return row ? toMonitoring(row) : null;
  },
};
