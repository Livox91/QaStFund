import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  evaluateOriginationDecision,
  ORIGINATION_DECISION_MODEL_VERSION,
  type OriginationDecisionInput,
} from "@/modules/loan-decisions/domain/origination-decision";
import {
  completedEmploymentMonths,
  isOriginationAuthorized,
} from "@/modules/loan-decisions/infrastructure/prisma-origination-decision-repository";

function input(
  overrides: Partial<OriginationDecisionInput> = {},
): OriginationDecisionInput {
  return {
    applicationReference: "application-1",
    employee: {
      active: true,
      verified: true,
      identityIntegrityResolved: true,
      tenureMonths: null,
      statusVerifiedAt: "2026-10-11T12:00:00.000Z",
    },
    application: {
      dataComplete: true,
      principalMinorUnits: 10_000n,
      feeMinorUnits: 500n,
      termDays: 30,
      repaymentStructure: "BULLET",
      policyVersion: 1,
      employerLoanLimitMinorUnits: 20_000n,
      productLoanLimitMinorUnits: 20_000n,
    },
    affordability: {
      verifiedNetIncomeMinorUnits: null,
      incomeVerifiedAt: null,
      incomeEvidenceFresh: false,
      existingMonthlyObligationsMinorUnits: 1_000n,
    },
    exposure: {
      outstandingPrincipalMinorUnits: 0n,
      maximumOutstandingPrincipalMinorUnits: 50_000n,
    },
    repaymentHistory: {
      completedOnTimeLoans: 2,
      lateLoans: 0,
      defaultedLoans: 0,
    },
    evidence: {
      requiredSourceDataFresh: true,
      financialRecordsConsistent: true,
    },
    ...overrides,
  };
}

describe("manual-review-first origination rules v1", () => {
  it("derives only completed calendar months from verified employment dates", () => {
    expect(
      completedEmploymentMonths(
        new Date("2024-01-31T00:00:00.000Z"),
        new Date("2024-02-29T12:00:00.000Z"),
      ),
    ).toBe(0);
    expect(
      completedEmploymentMonths(
        new Date("2024-01-15T00:00:00.000Z"),
        new Date("2025-03-15T00:00:00.000Z"),
      ),
    ).toBe(14);
    expect(
      completedEmploymentMonths(
        new Date("2027-01-01T00:00:00.000Z"),
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toBeNull();
  });
  it("is deterministic, versioned, and never emits a score", () => {
    const value = input();
    const result = evaluateOriginationDecision(value);

    expect(result).toEqual(evaluateOriginationDecision(value));
    expect(result.modelVersion).toBe(ORIGINATION_DECISION_MODEL_VERSION);
    expect(result.score).toBeNull();
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCodes).toContain("MANUAL_REVIEW_REQUIRED");
  });

  it("uses the full balloon repayment for a bullet loan", () => {
    const result = evaluateOriginationDecision(input());
    expect(result.affordability.proposedMonthlyObligationMinorUnits).toBe(
      10_500n,
    );
    expect(result.affordability.burdenRatioBasisPoints).toBeNull();
    expect(result.affordability.maximumBurdenBasisPoints).toBeNull();
  });

  it("rounds an explicitly supplied installment obligation up without scoring it", () => {
    const result = evaluateOriginationDecision(
      input({
        application: {
          ...input().application,
          repaymentStructure: "INSTALLMENT",
          installmentCount: 3,
        },
      }),
    );
    expect(result.affordability.proposedMonthlyObligationMinorUnits).toBe(
      3_500n,
    );
    expect(result.affordability.passed).toBeNull();
  });

  it.each([
    [null, null, false, "INCOME_UNAVAILABLE"],
    [50_000n, null, true, "INCOME_UNVERIFIED"],
    [50_000n, "2026-10-01T00:00:00.000Z", false, "INCOME_EVIDENCE_STALE"],
    [0n, "2026-10-11T12:00:00.000Z", true, "INCOME_INVALID"],
  ] as const)(
    "routes unresolved income evidence to review (%s, %s, %s)",
    (income, verifiedAt, fresh, reason) => {
      const result = evaluateOriginationDecision(
        input({
          affordability: {
            ...input().affordability,
            verifiedNetIncomeMinorUnits: income,
            incomeVerifiedAt: verifiedAt,
            incomeEvidenceFresh: fresh,
          },
        }),
      );
      expect(result.status).toBe("REVIEW_REQUIRED");
      expect(result.score).toBeNull();
      expect(result.reasonCodes).toContain(reason);
    },
  );

  it("requires review when verified employment tenure is unavailable", () => {
    const result = evaluateOriginationDecision(input());
    expect(result.reasonCodes).toContain("EMPLOYMENT_TENURE_UNAVAILABLE");
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it.each([
    [
      "NEW_TO_CREDIT",
      { completedOnTimeLoans: 0, lateLoans: 0, defaultedLoans: 0 },
    ],
    [
      "PRIOR_LATE_REPAYMENT",
      { completedOnTimeLoans: 1, lateLoans: 1, defaultedLoans: 0 },
    ],
    [
      "PRIOR_DEFAULT",
      { completedOnTimeLoans: 1, lateLoans: 0, defaultedLoans: 1 },
    ],
  ] as const)(
    "records %s as a fact without assigning points",
    (reason, history) => {
      const result = evaluateOriginationDecision(
        input({ repaymentHistory: history }),
      );
      expect(result.reasonCodes).toContain(reason);
      expect(result.score).toBeNull();
      expect(result.status).toBe("REVIEW_REQUIRED");
    },
  );

  it("allows exact configured limits", () => {
    const result = evaluateOriginationDecision(
      input({
        application: {
          ...input().application,
          principalMinorUnits: 20_000n,
        },
        exposure: {
          outstandingPrincipalMinorUnits: 30_000n,
          maximumOutstandingPrincipalMinorUnits: 50_000n,
        },
      }),
    );
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCodes).not.toEqual(
      expect.arrayContaining([
        "EMPLOYER_LOAN_LIMIT_EXCEEDED",
        "PRODUCT_LOAN_LIMIT_EXCEEDED",
        "EXPOSURE_LIMIT_EXCEEDED",
      ]),
    );
  });

  it.each([
    ["EMPLOYER_LOAN_LIMIT_EXCEEDED", { employerLoanLimitMinorUnits: 9_999n }],
    ["PRODUCT_LOAN_LIMIT_EXCEEDED", { productLoanLimitMinorUnits: 9_999n }],
  ] as const)("enforces the configured %s hard gate", (reason, limit) => {
    const result = evaluateOriginationDecision(
      input({ application: { ...input().application, ...limit } }),
    );
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain(reason);
  });

  it("rejects projected exposure above the configured maximum", () => {
    const result = evaluateOriginationDecision(
      input({
        exposure: {
          outstandingPrincipalMinorUnits: 40_001n,
          maximumOutstandingPrincipalMinorUnits: 50_000n,
        },
      }),
    );
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("EXPOSURE_LIMIT_EXCEEDED");
  });

  it("returns ineligible for an inactive employee", () => {
    const result = evaluateOriginationDecision(
      input({ employee: { ...input().employee, active: false } }),
    );
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("EMPLOYEE_INACTIVE");
  });

  it("returns ineligible for invalid terms", () => {
    const result = evaluateOriginationDecision(
      input({ application: { ...input().application, termDays: 0 } }),
    );
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("APPLICATION_INVALID");
  });

  it.each([
    [
      "EMPLOYEE_UNVERIFIED",
      { employee: { ...input().employee, verified: false } },
    ],
    [
      "IDENTITY_INTEGRITY_UNRESOLVED",
      { employee: { ...input().employee, identityIntegrityResolved: false } },
    ],
    [
      "REQUIRED_EVIDENCE_STALE",
      { evidence: { ...input().evidence, requiredSourceDataFresh: false } },
    ],
    [
      "FINANCIAL_RECORDS_CONFLICT",
      { evidence: { ...input().evidence, financialRecordsConsistent: false } },
    ],
  ] as const)(
    "preserves the review record but blocks approval for %s",
    (reason, overrides) => {
      const result = evaluateOriginationDecision(
        input(overrides as Partial<OriginationDecisionInput>),
      );
      expect(result.status).toBe("REVIEW_REQUIRED");
      expect(result.reasonCodes).toContain(reason);
      expect(
        isOriginationAuthorized({
          status: result.status,
          reasonCodes: [...result.reasonCodes],
          override: { outcome: "APPROVED" },
        }),
      ).toBe(false);
    },
  );

  it("requires an authorized human approval for an otherwise reviewable request", () => {
    const decision = evaluateOriginationDecision(input());
    expect(isOriginationAuthorized({ ...decision, override: null })).toBe(
      false,
    );
    expect(
      isOriginationAuthorized({
        ...decision,
        override: { outcome: "APPROVED" },
      }),
    ).toBe(true);
  });

  it("does not authorize historical score-based approval-consideration records", () => {
    expect(
      isOriginationAuthorized({
        status: "APPROVAL_CONSIDERATION",
        reasonCodes: ["SCORE_APPROVAL_BAND"],
        override: { outcome: "APPROVED" },
      }),
    ).toBe(false);
  });
});
