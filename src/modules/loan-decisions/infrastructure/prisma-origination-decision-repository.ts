import "server-only";

import { MembershipRole, type Prisma } from "@/generated/prisma/client";
import { validateEnvironment } from "@/infrastructure/config/environment";
import { prisma } from "@/infrastructure/database/prisma";
import { evaluateEmployeeDirectoryEligibility } from "@/modules/employee-directory/domain/employee-eligibility";
import {
  evaluateOriginationDecision,
  ORIGINATION_DECISION_MODEL_VERSION,
  type OriginationDecision,
  type OriginationDecisionInput,
} from "@/modules/loan-decisions/domain/origination-decision";
import { ApplicationError } from "@/shared/errors/application-error";

type Database = typeof prisma;

function snapshot(input: OriginationDecisionInput): Prisma.InputJsonObject {
  return {
    applicationReference: input.applicationReference,
    employee: { ...input.employee },
    application: {
      dataComplete: input.application.dataComplete,
      principalMinorUnits: input.application.principalMinorUnits.toString(),
      feeMinorUnits: input.application.feeMinorUnits.toString(),
      termDays: input.application.termDays,
      repaymentStructure: input.application.repaymentStructure,
      policyVersion: input.application.policyVersion,
      ...(input.application.installmentCount
        ? { installmentCount: input.application.installmentCount }
        : {}),
      employerLoanLimitMinorUnits:
        input.application.employerLoanLimitMinorUnits.toString(),
      productLoanLimitMinorUnits:
        input.application.productLoanLimitMinorUnits.toString(),
    },
    affordability: {
      verifiedNetIncomeMinorUnits:
        input.affordability.verifiedNetIncomeMinorUnits?.toString() ?? null,
      incomeVerifiedAt: input.affordability.incomeVerifiedAt,
      incomeEvidenceFresh: input.affordability.incomeEvidenceFresh,
      existingMonthlyObligationsMinorUnits:
        input.affordability.existingMonthlyObligationsMinorUnits.toString(),
      evidence: "UNAVAILABLE_NO_PAYROLL_PROVIDER",
    },
    exposure: {
      outstandingPrincipalMinorUnits:
        input.exposure.outstandingPrincipalMinorUnits.toString(),
      maximumOutstandingPrincipalMinorUnits:
        input.exposure.maximumOutstandingPrincipalMinorUnits.toString(),
    },
    repaymentHistory: { ...input.repaymentHistory },
    evidence: { ...input.evidence },
  };
}

function affordabilitySnapshot(
  decision: OriginationDecision,
): Prisma.InputJsonObject {
  return {
    proposedRepaymentMinorUnits:
      decision.affordability.proposedRepaymentMinorUnits.toString(),
    proposedMonthlyObligationMinorUnits:
      decision.affordability.proposedMonthlyObligationMinorUnits.toString(),
    totalMonthlyObligationsMinorUnits:
      decision.affordability.totalMonthlyObligationsMinorUnits.toString(),
    burdenRatioBasisPoints: decision.affordability.burdenRatioBasisPoints,
    maximumBurdenBasisPoints: decision.affordability.maximumBurdenBasisPoints,
    maximumPermittedPrincipalMinorUnits:
      decision.affordability.maximumPermittedPrincipalMinorUnits?.toString() ??
      null,
    passed: decision.affordability.passed,
    featureScores: { ...decision.featureScores },
  };
}

export async function evaluateAndPersistLoanOrigination(input: {
  organizationId: string;
  loanId: string;
  evaluatedAt: Date;
  database?: Database;
}) {
  const database = input.database ?? prisma;
  const maxDirectoryAgeMs =
    validateEnvironment().ERP_NEXT_ELIGIBILITY_MAX_AGE_MINUTES * 60_000;
  return database.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${input.loanId}, 1))
    `;
    const existing = await transaction.loanOriginationDecision.findUnique({
      where: {
        loanId_modelVersion: {
          loanId: input.loanId,
          modelVersion: ORIGINATION_DECISION_MODEL_VERSION,
        },
      },
      include: { override: true },
    });
    if (existing) return existing;

    const loan = await transaction.loan.findFirst({
      where: { id: input.loanId, organizationId: input.organizationId },
      select: {
        id: true,
        borrowerMembershipId: true,
        principalAmountMinorUnits: true,
        feeAmountMinorUnits: true,
        currency: true,
        durationDays: true,
        borrowerMembership: {
          select: {
            isActive: true,
            employmentStatus: true,
            employmentStatusSource: true,
            employmentStatusSyncedAt: true,
            role: true,
            employeeDirectoryMappings: {
              where: { matchStatus: "MATCHED" },
              select: { id: true },
              take: 1,
            },
          },
        },
        organization: {
          select: {
            erpNextEnabled: true,
            lendingPolicy: {
              select: {
                policyVersion: true,
                maxLoanAmountMinorUnits: true,
                maxOutstandingDebtMinorUnits: true,
              },
            },
            employeeDirectoryIntegration: {
              select: {
                lastSyncStatus: true,
                lastSuccessfulSyncAt: true,
              },
            },
          },
        },
        lendingOffer: {
          select: { maximumLoanAmountMinorUnits: true },
        },
      },
    });
    if (!loan?.organization.lendingPolicy || !loan.lendingOffer) return null;

    const priorLoans = await transaction.loan.findMany({
      where: {
        organizationId: input.organizationId,
        borrowerMembershipId: loan.borrowerMembershipId,
        id: { not: loan.id },
        status: { in: ["ACTIVE", "OVERDUE", "DEFAULTED", "REPAID"] },
      },
      select: {
        status: true,
        principalAmountMinorUnits: true,
        feeAmountMinorUnits: true,
        currency: true,
        outstandingPrincipalMinorUnits: true,
        repaymentDueAt: true,
        closedAt: true,
        repayments: {
          where: { status: "COMPLETED" },
          select: { amountMinorUnits: true },
        },
      },
    });
    const directory = evaluateEmployeeDirectoryEligibility({
      erpNextEnabled: loan.organization.erpNextEnabled,
      integration: loan.organization.employeeDirectoryIntegration,
      employee: loan.borrowerMembership,
      now: input.evaluatedAt,
      maxAgeMs: maxDirectoryAgeMs,
    });
    const existingMonthlyObligationsMinorUnits = priorLoans
      .filter((item) =>
        ["ACTIVE", "OVERDUE", "DEFAULTED"].includes(item.status),
      )
      .reduce((sum, item) => {
        const agreed =
          item.principalAmountMinorUnits + item.feeAmountMinorUnits;
        const repaid = item.repayments.reduce(
          (total, repayment) => total + repayment.amountMinorUnits,
          0n,
        );
        return sum + (repaid < agreed ? agreed - repaid : 0n);
      }, 0n);
    const financialRecordsConsistent = priorLoans.every((item) => {
      const agreed = item.principalAmountMinorUnits + item.feeAmountMinorUnits;
      const repaid = item.repayments.reduce(
        (total, repayment) => total + repayment.amountMinorUnits,
        0n,
      );
      return (
        item.currency === loan.currency &&
        item.principalAmountMinorUnits > 0n &&
        item.feeAmountMinorUnits >= 0n &&
        item.outstandingPrincipalMinorUnits >= 0n &&
        item.outstandingPrincipalMinorUnits <= item.principalAmountMinorUnits &&
        item.repayments.every((repayment) => repayment.amountMinorUnits > 0n) &&
        repaid <= agreed &&
        (item.status !== "REPAID" || item.outstandingPrincipalMinorUnits === 0n)
      );
    });
    const decisionInput: OriginationDecisionInput = {
      applicationReference: loan.id,
      employee: {
        active:
          loan.borrowerMembership.isActive &&
          loan.borrowerMembership.role === MembershipRole.EMPLOYEE &&
          loan.borrowerMembership.employmentStatus === "ACTIVE",
        verified: directory.trusted,
        identityIntegrityResolved:
          !loan.organization.erpNextEnabled ||
          loan.borrowerMembership.employeeDirectoryMappings.length === 1,
        // ERPNext Employee does not currently supply a verified employment
        // start date, so v1 must not manufacture tenure evidence.
        tenureMonths: null,
        statusVerifiedAt:
          loan.borrowerMembership.employmentStatusSyncedAt?.toISOString() ??
          null,
      },
      application: {
        dataComplete: true,
        principalMinorUnits: loan.principalAmountMinorUnits,
        feeMinorUnits: loan.feeAmountMinorUnits,
        termDays: loan.durationDays,
        repaymentStructure: "BULLET",
        policyVersion: loan.organization.lendingPolicy.policyVersion,
        employerLoanLimitMinorUnits:
          loan.organization.lendingPolicy.maxLoanAmountMinorUnits,
        productLoanLimitMinorUnits:
          loan.lendingOffer.maximumLoanAmountMinorUnits,
      },
      affordability: {
        // Payroll is an explicit future integration. No verified income exists.
        verifiedNetIncomeMinorUnits: null,
        incomeVerifiedAt: null,
        incomeEvidenceFresh: false,
        existingMonthlyObligationsMinorUnits,
      },
      exposure: {
        outstandingPrincipalMinorUnits: priorLoans.reduce(
          (sum, item) => sum + item.outstandingPrincipalMinorUnits,
          0n,
        ),
        maximumOutstandingPrincipalMinorUnits:
          loan.organization.lendingPolicy.maxOutstandingDebtMinorUnits,
      },
      repaymentHistory: {
        completedOnTimeLoans: priorLoans.filter(
          (item) =>
            item.status === "REPAID" &&
            item.closedAt !== null &&
            item.closedAt <= item.repaymentDueAt,
        ).length,
        lateLoans: priorLoans.filter(
          (item) =>
            item.status === "OVERDUE" ||
            (item.status === "REPAID" &&
              item.closedAt !== null &&
              item.closedAt > item.repaymentDueAt),
        ).length,
        defaultedLoans: priorLoans.filter((item) => item.status === "DEFAULTED")
          .length,
      },
      evidence: {
        requiredSourceDataFresh: directory.trusted,
        financialRecordsConsistent,
      },
    };
    const decision = evaluateOriginationDecision(decisionInput);
    const idempotencyKey = `${loan.id}:${decision.modelVersion}`;
    const created = await transaction.loanOriginationDecision.create({
      data: {
        organizationId: input.organizationId,
        loanId: loan.id,
        borrowerMembershipId: loan.borrowerMembershipId,
        idempotencyKey,
        modelVersion: decision.modelVersion,
        status: decision.status,
        score: decision.score,
        reasonCodes: [...decision.reasonCodes],
        inputSnapshot: snapshot(decisionInput),
        affordabilitySnapshot: affordabilitySnapshot(decision),
        evaluatedAt: input.evaluatedAt,
      },
      include: { override: true },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        loanId: loan.id,
        targetMembershipId: loan.borrowerMembershipId,
        type: "LOAN_ORIGINATION_DECISION_RECORDED",
        title: "Versioned origination decision recorded",
        occurredAt: input.evaluatedAt,
        metadata: {
          decisionId: created.id,
          modelVersion: created.modelVersion,
          status: created.status,
          score: created.score,
          reasonCodes: created.reasonCodes,
        },
      },
    });
    return created;
  });
}

export function isOriginationAuthorized(decision: {
  status: string;
  reasonCodes?: string[];
  override: { outcome: string } | null;
}): boolean {
  if (decision.override?.outcome === "APPROVED") {
    return (
      ["APPROVAL_CONSIDERATION", "REVIEW_REQUIRED"].includes(decision.status) &&
      !(decision.reasonCodes ?? []).some((reason) =>
        [
          "APPLICATION_INVALID",
          "APPLICATION_DATA_INCOMPLETE",
          "EMPLOYEE_INACTIVE",
          "EMPLOYEE_UNVERIFIED",
          "IDENTITY_INTEGRITY_UNRESOLVED",
          "REQUIRED_EVIDENCE_STALE",
          "FINANCIAL_RECORDS_CONFLICT",
          "INCOME_UNVERIFIED",
          "INCOME_EVIDENCE_STALE",
          "INCOME_INVALID",
          "AFFORDABILITY_EXCEEDED",
          "EMPLOYER_LOAN_LIMIT_EXCEEDED",
          "PRODUCT_LOAN_LIMIT_EXCEEDED",
          "EXPOSURE_LIMIT_EXCEEDED",
        ].includes(reason),
      )
    );
  }
  // APPROVAL_CONSIDERATION is a recommendation, not approval. The controlled
  // pilot always requires an immutable employer-admin review before signing.
  return false;
}

export async function getEmployeeOriginationDecision(input: {
  organizationId: string;
  userId: string;
  loanId: string;
}) {
  return prisma.loanOriginationDecision.findFirst({
    where: {
      organizationId: input.organizationId,
      loanId: input.loanId,
      borrowerMembership: { userId: input.userId },
    },
    select: {
      id: true,
      loanId: true,
      modelVersion: true,
      status: true,
      evaluatedAt: true,
      override: { select: { outcome: true, reviewedAt: true } },
    },
  });
}

export async function getEmployerOriginationDecision(input: {
  organizationId: string;
  decisionId: string;
}) {
  return prisma.loanOriginationDecision.findFirst({
    where: { organizationId: input.organizationId, id: input.decisionId },
    include: { override: true },
  });
}

export async function findEmployerOriginationDecisionForLoan(input: {
  organizationId: string;
  loanId: string;
}) {
  return prisma.loanOriginationDecision.findFirst({
    where: { organizationId: input.organizationId, loanId: input.loanId },
    orderBy: { evaluatedAt: "desc" },
    select: {
      id: true,
      loanId: true,
      modelVersion: true,
      status: true,
      score: true,
      reasonCodes: true,
      evaluatedAt: true,
      affordabilitySnapshot: true,
      override: {
        select: {
          outcome: true,
          rationale: true,
          reviewedAt: true,
          reviewedByMembership: {
            select: { user: { select: { name: true } } },
          },
        },
      },
    },
  });
}

export async function listEmployerOriginationDecisions(input: {
  organizationId: string;
  status?: "APPROVAL_CONSIDERATION" | "REVIEW_REQUIRED" | "NOT_ELIGIBLE";
}) {
  const decisions = await prisma.loanOriginationDecision.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.status === "REVIEW_REQUIRED" ? { override: null } : {}),
    },
    orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      loanId: true,
      borrowerMembershipId: true,
      modelVersion: true,
      status: true,
      score: true,
      reasonCodes: true,
      evaluatedAt: true,
      loan: {
        select: {
          principalAmountMinorUnits: true,
          feeAmountMinorUnits: true,
          currency: true,
          status: true,
        },
      },
      borrowerMembership: {
        select: { user: { select: { name: true } } },
      },
      override: {
        select: { outcome: true, reviewedAt: true },
      },
    },
  });
  return decisions.map((decision) => ({
    ...decision,
    loan: {
      ...decision.loan,
      principalAmountMinorUnits:
        decision.loan.principalAmountMinorUnits.toString(),
      feeAmountMinorUnits: decision.loan.feeAmountMinorUnits.toString(),
    },
  }));
}

export async function overrideOriginationDecision(input: {
  organizationId: string;
  reviewerUserId: string;
  decisionId: string;
  outcome: "APPROVED" | "REJECTED";
  rationale: string;
  reviewedAt: Date;
}) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${input.decisionId}, 2))
    `;
    const reviewer = await transaction.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: input.reviewerUserId,
        },
      },
      select: {
        id: true,
        role: true,
        isActive: true,
        user: { select: { name: true } },
      },
    });
    if (
      !reviewer?.isActive ||
      reviewer.role !== MembershipRole.EMPLOYER_ADMIN
    ) {
      return null;
    }
    const decision = await transaction.loanOriginationDecision.findFirst({
      where: { id: input.decisionId, organizationId: input.organizationId },
      select: {
        id: true,
        loanId: true,
        borrowerMembershipId: true,
        status: true,
        reasonCodes: true,
      },
    });
    if (!decision) return null;
    if (
      input.outcome === "APPROVED" &&
      !isOriginationAuthorized({
        status: decision.status,
        reasonCodes: decision.reasonCodes,
        override: { outcome: input.outcome },
      })
    ) {
      throw new ApplicationError(
        "LOAN_DECISION_OVERRIDE_NOT_ALLOWED",
        "This decision contains a mandatory eligibility failure and cannot be approved by override.",
        422,
      );
    }
    const existing = await transaction.loanOriginationOverride.findUnique({
      where: { decisionId: decision.id },
    });
    if (existing) return existing;
    const transitioned = await transaction.loan.updateMany({
      where: {
        id: decision.loanId,
        organizationId: input.organizationId,
        status: "REQUESTED",
      },
      data:
        input.outcome === "APPROVED"
          ? { status: "APPROVED", approvedAt: input.reviewedAt }
          : { status: "CANCELLED", closedAt: input.reviewedAt },
    });
    if (transitioned.count !== 1) {
      throw new ApplicationError(
        "LOAN_DECISION_STATE_CONFLICT",
        "This application is no longer awaiting review.",
        409,
      );
    }
    const created = await transaction.loanOriginationOverride.create({
      data: {
        organizationId: input.organizationId,
        decisionId: decision.id,
        loanId: decision.loanId,
        reviewedByMembershipId: reviewer.id,
        outcome: input.outcome,
        rationale: input.rationale,
        reviewedAt: input.reviewedAt,
      },
    });
    await transaction.auditEvent.createMany({
      data: [
        {
          organizationId: input.organizationId,
          loanId: decision.loanId,
          actorMembershipId: reviewer.id,
          targetMembershipId: decision.borrowerMembershipId,
          type:
            created.outcome === "APPROVED" ? "LOAN_APPROVED" : "LOAN_CANCELLED",
          title:
            created.outcome === "APPROVED"
              ? "Loan application approved for offer acceptance"
              : "Loan application rejected and cancelled",
          actorLabel: reviewer.user.name,
          occurredAt: input.reviewedAt,
          metadata: {
            decisionId: decision.id,
            reviewOutcome: created.outcome,
          },
        },
        {
          organizationId: input.organizationId,
          loanId: decision.loanId,
          actorMembershipId: reviewer.id,
          targetMembershipId: decision.borrowerMembershipId,
          type: "LOAN_ORIGINATION_DECISION_OVERRIDDEN",
          title: "Origination decision reviewed by employer administrator",
          actorLabel: reviewer.user.name,
          occurredAt: input.reviewedAt,
          metadata: {
            decisionId: decision.id,
            outcome: created.outcome,
            rationale: created.rationale,
          },
        },
      ],
    });
    return created;
  });
}
