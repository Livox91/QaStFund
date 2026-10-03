import { describe, expect, it, vi } from "vitest";

import { parseEnvironment } from "@/infrastructure/config/environment";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import {
  evaluateEmployeeLoans,
  evaluateOrganizationLoans,
} from "@/modules/loan-decisions/application/evaluate-loan";
import {
  getLoanReview,
  markLoanDecisionReviewed,
} from "@/modules/loan-decisions/application/loan-monitoring";
import type {
  LoanDecisionCandidate,
  LoanDecisionEvaluationRecord,
  LoanDecisionRepository,
  LoanMonitoringRecord,
} from "@/modules/loan-decisions/application/ports/loan-decision-repository";
import { DecisionModelUnavailableError } from "@/modules/loan-decisions/domain/loan-decision";
import { createLoanDecisionEngine } from "@/modules/loan-decisions/infrastructure/decision-engine-provider";
import { ModelDecisionAdapter } from "@/modules/loan-decisions/infrastructure/model-decision-adapter";
import { RuleBasedDecisionAdapter } from "@/modules/loan-decisions/infrastructure/rule-based-decision-adapter";
import type { Clock } from "@/shared/time/clock";

const dueAt = new Date("2026-10-01T00:00:00.000Z");
const candidate: LoanDecisionCandidate = {
  loanId: "20000000-0000-4000-8000-000000000001",
  principalBaseUnits: "100000000",
  repaymentBaseUnits: "105000000",
  startedAt: new Date("2026-09-01T00:00:00.000Z"),
  dueAt,
  borrower: {
    employeeId: "employee-b",
    organizationId: "organization-a",
    employmentStatus: "active",
  },
  loanStatus: "active",
};

const admin: AuthenticatedActor = {
  userId: "admin-a",
  email: "admin@organization-a.test",
  name: "Admin A",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYER_ADMIN,
};

function clock(now: string): Clock {
  return { now: () => new Date(now) };
}

function createRepository(): LoanDecisionRepository & {
  evaluations: LoanDecisionEvaluationRecord[];
} {
  const evaluations: LoanDecisionEvaluationRecord[] = [];
  const monitoring: LoanMonitoringRecord = {
    loanId: candidate.loanId,
    borrowerName: "Bob",
    lenderName: "Alice",
    principalAmountMinorUnits: 10_000n,
    feeAmountMinorUnits: 500n,
    outstandingRepaymentMinorUnits: 10_500n,
    currency: "USD",
    dueAt,
    financialStatus: "ACTIVE",
    evaluation: {
      id: "evaluation-1",
      loanId: candidate.loanId,
      classification: "default_candidate",
      recommendedAction: "employer_review",
      reasonCodes: ["PAST_DUE_7_DAYS"],
      source: "rules",
      modelVersion: null,
      evaluatedAt: new Date("2026-10-09T00:00:00.000Z"),
    },
    reviewedAt: null,
    reviewedByName: null,
    reviews: [],
  };
  return {
    evaluations,
    listCandidates: vi.fn(async (organizationId) =>
      organizationId === "organization-a" ? [candidate] : [],
    ),
    listParticipantCandidates: vi.fn(async ({ organizationId, userId }) =>
      organizationId === "organization-a" && userId === "employee-a"
        ? [candidate]
        : [],
    ),
    findCandidate: vi.fn(async ({ organizationId }) =>
      organizationId === "organization-a" ? candidate : null,
    ),
    saveEvaluation: vi.fn(async ({ decision, loanId }) => {
      const latest = evaluations.at(-1);
      if (
        latest &&
        latest.classification === decision.classification &&
        latest.recommendedAction === decision.recommendedAction
      ) {
        return latest;
      }
      const evaluation: LoanDecisionEvaluationRecord = {
        id: `evaluation-${evaluations.length + 1}`,
        loanId,
        classification: decision.classification,
        recommendedAction: decision.recommendedAction,
        reasonCodes: decision.reasonCodes,
        source: decision.source,
        modelVersion: decision.modelVersion ?? null,
        evaluatedAt: decision.evaluatedAt,
      };
      evaluations.push(evaluation);
      return evaluation;
    }),
    listMonitoring: vi.fn(async (organizationId) =>
      organizationId === "organization-a" ? [monitoring] : [],
    ),
    findMonitoring: vi.fn(async ({ organizationId }) =>
      organizationId === "organization-a" ? monitoring : null,
    ),
    markReviewed: vi.fn(async (input) => ({
      ...monitoring,
      reviewedAt: input.reviewedAt,
      reviewedByName: "Admin A",
    })),
  };
}

describe("rule-based loan decisions", () => {
  const engine = new RuleBasedDecisionAdapter();

  it.each([
    ["2026-09-20T00:00:00.000Z", "healthy", "none", "LOAN_CURRENT"],
    ["2026-09-29T00:00:00.000Z", "due_soon", "remind", "DUE_WITHIN_3_DAYS"],
    ["2026-10-02T00:00:00.000Z", "overdue", "flag_for_review", "PAST_DUE"],
    [
      "2026-10-09T00:00:00.000Z",
      "default_candidate",
      "employer_review",
      "PAST_DUE_7_DAYS",
    ],
  ])(
    "classifies a loan at controlled time %s",
    async (now, classification, recommendedAction, reason) => {
      const decision = await engine.evaluate({
        ...candidate,
        currentTime: new Date(now),
      });
      expect(decision).toMatchObject({
        classification,
        recommendedAction,
        source: "rules",
      });
      expect(decision.reasonCodes).toContain(reason);
      expect(decision.evaluatedAt).toEqual(new Date(now));
    },
  );

  it("never treats a repaid loan as an actionable default candidate", async () => {
    await expect(
      engine.evaluate({
        ...candidate,
        loanStatus: "repaid",
        currentTime: new Date("2026-12-01T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      classification: "healthy",
      recommendedAction: "none",
      reasonCodes: ["LOAN_REPAID"],
    });
  });

  it("is deterministic for identical inputs", async () => {
    const input = {
      ...candidate,
      currentTime: new Date("2026-10-09T00:00:00.000Z"),
    };
    expect(await engine.evaluate(input)).toEqual(await engine.evaluate(input));
  });
});

describe("decision provider and evaluation boundary", () => {
  const validEnvironment = {
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
    APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_CIRCLE_CLIENT_KEY: "test-client-key",
    NEXT_PUBLIC_CIRCLE_CLIENT_URL: "https://example.test/rpc",
  };

  it("defaults provider configuration to rules and rejects unknown providers", () => {
    expect(parseEnvironment(validEnvironment).LOAN_DECISION_PROVIDER).toBe(
      "rules",
    );
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        LOAN_DECISION_PROVIDER: "random",
      }),
    ).toThrow("Invalid environment configuration");
  });

  it("switches providers without changing the consumer interface", () => {
    expect(createLoanDecisionEngine("rules")).toBeInstanceOf(
      RuleBasedDecisionAdapter,
    );
    expect(createLoanDecisionEngine("model")).toBeInstanceOf(
      ModelDecisionAdapter,
    );
  });

  it("fails safely when the future model provider is selected", async () => {
    await expect(
      createLoanDecisionEngine("model").evaluate({
        ...candidate,
        currentTime: dueAt,
      }),
    ).rejects.toBeInstanceOf(DecisionModelUnavailableError);
  });

  it("persists decision transitions without financial side effects", async () => {
    const repository = createRepository();
    const engine = new RuleBasedDecisionAdapter();

    await evaluateOrganizationLoans(
      admin,
      engine,
      repository,
      clock("2026-09-29T00:00:00.000Z"),
    );
    await evaluateOrganizationLoans(
      admin,
      engine,
      repository,
      clock("2026-09-29T00:00:00.000Z"),
    );
    await evaluateOrganizationLoans(
      admin,
      engine,
      repository,
      clock("2026-10-09T00:00:00.000Z"),
    );

    expect(repository.evaluations.map((item) => item.classification)).toEqual([
      "due_soon",
      "default_candidate",
    ]);
    expect(candidate.loanStatus).toBe("active");
  });

  it("records review without resolving or changing financial state", async () => {
    const repository = createRepository();
    const result = await markLoanDecisionReviewed(
      admin,
      candidate.loanId,
      repository,
      clock("2026-10-09T12:00:00.000Z"),
    );
    expect(repository.markReviewed).toHaveBeenCalledWith({
      organizationId: "organization-a",
      loanId: candidate.loanId,
      reviewedByUserId: "admin-a",
      reviewedAt: new Date("2026-10-09T12:00:00.000Z"),
    });
    expect(result?.financialStatus).toBe("ACTIVE");
    expect(result?.evaluation.classification).toBe("default_candidate");
  });

  it("keeps employer evaluation queries isolated to their organization", async () => {
    const repository = createRepository();
    const organizationBAdmin = {
      ...admin,
      userId: "admin-b",
      organizationId: "organization-b",
      organizationName: "Organization B",
      organizationSlug: "organization-b",
    };

    await expect(
      evaluateOrganizationLoans(
        organizationBAdmin,
        new RuleBasedDecisionAdapter(),
        repository,
        clock("2026-10-09T00:00:00.000Z"),
      ),
    ).resolves.toEqual([]);
    expect(repository.listCandidates).toHaveBeenCalledWith("organization-b");
    expect(repository.saveEvaluation).not.toHaveBeenCalled();
  });

  it("does not expose another organization's loan review", async () => {
    const repository = createRepository();
    const organizationBAdmin = {
      ...admin,
      userId: "admin-b",
      organizationId: "organization-b",
      organizationName: "Organization B",
      organizationSlug: "organization-b",
    };

    await expect(
      getLoanReview(
        organizationBAdmin,
        candidate.loanId,
        new RuleBasedDecisionAdapter(),
        repository,
        clock("2026-10-09T00:00:00.000Z"),
      ),
    ).resolves.toBeNull();
    expect(repository.findCandidate).toHaveBeenCalledWith({
      organizationId: "organization-b",
      loanId: candidate.loanId,
    });
    expect(repository.findMonitoring).not.toHaveBeenCalled();
  });

  it("evaluates only loans in the employee's participant scope", async () => {
    const repository = createRepository();
    const employee = {
      ...admin,
      userId: "employee-a",
      role: ApplicationRole.EMPLOYEE,
    };

    await evaluateEmployeeLoans(
      employee,
      new RuleBasedDecisionAdapter(),
      repository,
      clock("2026-10-09T00:00:00.000Z"),
    );

    expect(repository.listParticipantCandidates).toHaveBeenCalledWith({
      organizationId: "organization-a",
      userId: "employee-a",
    });
    expect(repository.saveEvaluation).toHaveBeenCalledTimes(1);
  });
});
