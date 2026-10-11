import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  evaluateOriginationDecision,
  ORIGINATION_DECISION_CONFIG_V1,
  validateOriginationDecisionConfig,
  type OriginationDecisionInput,
} from "@/modules/loan-decisions/domain/origination-decision";
import { isOriginationAuthorized } from "@/modules/loan-decisions/infrastructure/prisma-origination-decision-repository";

function input(
  overrides: Partial<OriginationDecisionInput> = {},
): OriginationDecisionInput {
  return {
    applicationReference: "application-1",
    employee: {
      active: true,
      verified: true,
      identityIntegrityResolved: true,
      tenureMonths: 30,
      statusVerifiedAt: "2026-10-11T12:00:00.000Z",
    },
    application: {
      dataComplete: true,
      principalMinorUnits: 10_000n,
      feeMinorUnits: 500n,
      termDays: 30,
      repaymentStructure: "INSTALLMENT",
      installmentCount: 3,
      policyVersion: 1,
      employerLoanLimitMinorUnits: 20_000n,
      productLoanLimitMinorUnits: 20_000n,
    },
    affordability: {
      verifiedNetIncomeMinorUnits: 50_000n,
      incomeVerifiedAt: "2026-10-11T12:00:00.000Z",
      incomeEvidenceFresh: true,
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

describe("origination decision rules v1", () => {
  it("validates the immutable 100-point configuration", () => {
    expect(() =>
      validateOriginationDecisionConfig(ORIGINATION_DECISION_CONFIG_V1),
    ).not.toThrow();
    expect(() =>
      validateOriginationDecisionConfig({
        ...ORIGINATION_DECISION_CONFIG_V1,
        weights: {
          ...ORIGINATION_DECISION_CONFIG_V1.weights,
          affordability: 29,
        },
      }),
    ).toThrow("Invalid origination decision configuration");
  });

  it("returns identical results for identical versioned inputs", () => {
    const value = input();
    expect(evaluateOriginationDecision(value)).toEqual(
      evaluateOriginationDecision(value),
    );
  });

  it("uses the full balloon repayment for a bullet loan", () => {
    const result = evaluateOriginationDecision(
      input({
        application: {
          ...input().application,
          repaymentStructure: "BULLET",
          installmentCount: 1,
        },
      }),
    );
    expect(result.affordability.proposedMonthlyObligationMinorUnits).toBe(
      10_500n,
    );
  });

  it("rounds installment obligations up", () => {
    expect(
      evaluateOriginationDecision(input()).affordability
        .proposedMonthlyObligationMinorUnits,
    ).toBe(3_500n);
  });

  it("calculates maximum permitted principal for installment and bullet terms", () => {
    const installment = evaluateOriginationDecision(input());
    const bullet = evaluateOriginationDecision(
      input({
        application: {
          ...input().application,
          repaymentStructure: "BULLET",
          installmentCount: undefined,
        },
      }),
    );
    expect(installment.affordability.maximumPermittedPrincipalMinorUnits).toBe(
      56_500n,
    );
    expect(bullet.affordability.maximumPermittedPrincipalMinorUnits).toBe(
      18_500n,
    );
  });

  it.each([
    [10_000n, 30],
    [6_667n, 24],
    [5_000n, 12],
  ])("scores affordability at the %s income boundary", (income, score) => {
    const value = input({
      application: {
        ...input().application,
        principalMinorUnits: 2_000n,
        feeMinorUnits: 0n,
        installmentCount: 1,
      },
      affordability: {
        ...input().affordability,
        verifiedNetIncomeMinorUnits: income,
        existingMonthlyObligationsMinorUnits: 0n,
      },
    });
    expect(evaluateOriginationDecision(value).featureScores.affordability).toBe(
      score,
    );
  });

  it("rejects an affordability result above forty percent", () => {
    const result = evaluateOriginationDecision(
      input({
        affordability: {
          ...input().affordability,
          verifiedNetIncomeMinorUnits: 10_000n,
          existingMonthlyObligationsMinorUnits: 1_000n,
        },
      }),
    );
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("AFFORDABILITY_EXCEEDED");
  });

  it.each([
    [null, "INCOME_UNAVAILABLE"],
    [0n, "INCOME_INVALID"],
  ] as const)("fails safely for income %s", (income, reason) => {
    const result = evaluateOriginationDecision(
      input({
        affordability: {
          ...input().affordability,
          verifiedNetIncomeMinorUnits: income,
          existingMonthlyObligationsMinorUnits: 0n,
        },
      }),
    );
    expect(result.score).toBeNull();
    expect(result.reasonCodes).toContain(reason);
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("does not punish new-to-credit applicants as a missing-data error", () => {
    const result = evaluateOriginationDecision(
      input({
        repaymentHistory: {
          completedOnTimeLoans: 0,
          lateLoans: 0,
          defaultedLoans: 0,
        },
      }),
    );
    expect(result.featureScores.repaymentHistory).toBe(25);
    expect(result.reasonCodes).toContain("NEW_TO_CREDIT");
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it.each([
    [5, 5],
    [6, 10],
    [12, 15],
    [24, 20],
  ])("scores %s months of employment at %s", (tenureMonths, score) => {
    const result = evaluateOriginationDecision(
      input({ employee: { ...input().employee, tenureMonths } }),
    );
    expect(result.featureScores.employmentStability).toBe(score);
  });

  it("requires review when tenure evidence is absent", () => {
    const result = evaluateOriginationDecision(
      input({ employee: { ...input().employee, tenureMonths: null } }),
    );
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.score).toBeNull();
  });

  it("requires review for unverified employee evidence", () => {
    const result = evaluateOriginationDecision(
      input({ employee: { ...input().employee, verified: false } }),
    );
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCodes).toContain("EMPLOYEE_UNVERIFIED");
  });

  it("requires review when application data is incomplete", () => {
    const result = evaluateOriginationDecision(
      input({
        application: { ...input().application, dataComplete: false },
      }),
    );
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.score).toBeNull();
    expect(result.reasonCodes).toContain("APPLICATION_DATA_INCOMPLETE");
  });

  it.each([
    [null, true, "INCOME_UNVERIFIED"],
    ["2026-10-01T00:00:00.000Z", false, "INCOME_EVIDENCE_STALE"],
  ] as const)(
    "requires review for unresolved income verification (%s, %s)",
    (incomeVerifiedAt, incomeEvidenceFresh, reason) => {
      const result = evaluateOriginationDecision(
        input({
          affordability: {
            ...input().affordability,
            incomeVerifiedAt,
            incomeEvidenceFresh,
          },
        }),
      );
      expect(result.status).toBe("REVIEW_REQUIRED");
      expect(result.score).toBeNull();
      expect(result.reasonCodes).toContain(reason);
    },
  );

  it("rejects invalid application terms", () => {
    const result = evaluateOriginationDecision(
      input({ application: { ...input().application, termDays: 0 } }),
    );
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toContain("APPLICATION_INVALID");
  });

  it.each([
    [
      { completedOnTimeLoans: 1, lateLoans: 0, defaultedLoans: 0 },
      35,
      undefined,
    ],
    [
      { completedOnTimeLoans: 1, lateLoans: 1, defaultedLoans: 0 },
      15,
      "PRIOR_LATE_REPAYMENT",
    ],
    [
      { completedOnTimeLoans: 1, lateLoans: 0, defaultedLoans: 1 },
      0,
      "PRIOR_DEFAULT",
    ],
  ] as const)(
    "profiles authoritative repayment history without fabricating defaults",
    (repaymentHistory, expectedScore, reason) => {
      const result = evaluateOriginationDecision(input({ repaymentHistory }));
      expect(result.featureScores.repaymentHistory).toBe(expectedScore);
      if (reason) {
        expect(result.reasonCodes).toContain(reason);
      } else {
        expect(result.reasonCodes).not.toContain("PRIOR_DEFAULT");
      }
    },
  );

  it.each([
    [75, "APPROVAL_CONSIDERATION"],
    [55, "REVIEW_REQUIRED"],
    [54, "NOT_ELIGIBLE"],
  ] as const)("applies the %s score boundary", (expectedScore, status) => {
    const value =
      expectedScore === 75
        ? input({
            employee: { ...input().employee, tenureMonths: 5 },
            exposure: {
              outstandingPrincipalMinorUnits: 0n,
              maximumOutstandingPrincipalMinorUnits: 13_334n,
            },
          })
        : expectedScore === 55
          ? input({
              employee: { ...input().employee, tenureMonths: 5 },
              exposure: {
                outstandingPrincipalMinorUnits: 0n,
                maximumOutstandingPrincipalMinorUnits: 15_000n,
              },
              repaymentHistory: {
                completedOnTimeLoans: 1,
                lateLoans: 1,
                defaultedLoans: 0,
              },
            })
          : input({
              employee: { ...input().employee, tenureMonths: 6 },
              affordability: {
                ...input().affordability,
                verifiedNetIncomeMinorUnits: 15_000n,
                existingMonthlyObligationsMinorUnits: 1_000n,
              },
              exposure: {
                outstandingPrincipalMinorUnits: 0n,
                maximumOutstandingPrincipalMinorUnits: 15_000n,
              },
              repaymentHistory: {
                completedOnTimeLoans: 1,
                lateLoans: 1,
                defaultedLoans: 0,
              },
            });
    const result = evaluateOriginationDecision(value);
    expect(result.score).toBe(expectedScore);
    expect(result.status).toBe(status);
  });

  it.each([
    [
      { requiredSourceDataFresh: false, financialRecordsConsistent: true },
      "REQUIRED_EVIDENCE_STALE",
    ],
    [
      { requiredSourceDataFresh: true, financialRecordsConsistent: false },
      "FINANCIAL_RECORDS_CONFLICT",
    ],
  ] as const)("requires review for unsafe evidence: %s", (evidence, reason) => {
    const result = evaluateOriginationDecision(input({ evidence }));
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.score).toBeNull();
    expect(result.affordability.burdenRatioBasisPoints).toBeNull();
    expect(result.reasonCodes).toContain(reason);
  });

  it("never considers approval while income or tenure evidence is missing", () => {
    for (const value of [
      input({
        affordability: {
          ...input().affordability,
          verifiedNetIncomeMinorUnits: null,
          existingMonthlyObligationsMinorUnits: 0n,
        },
      }),
      input({ employee: { ...input().employee, tenureMonths: null } }),
    ]) {
      expect(evaluateOriginationDecision(value).status).toBe("REVIEW_REQUIRED");
    }
  });

  it.each([
    [40_000n, 15],
    [20_000n, 10],
    [13_334n, 5],
    [12_500n, 0],
  ])("scores projected exposure %s at %s", (maximum, score) => {
    const result = evaluateOriginationDecision(
      input({
        application: { ...input().application, principalMinorUnits: 10_000n },
        exposure: {
          outstandingPrincipalMinorUnits: 0n,
          maximumOutstandingPrincipalMinorUnits: maximum,
        },
      }),
    );
    expect(result.featureScores.existingExposure).toBe(score);
  });

  it("allows the exact exposure limit but rejects a verified exceedance", () => {
    const boundary = input({
      exposure: {
        outstandingPrincipalMinorUnits: 10_000n,
        maximumOutstandingPrincipalMinorUnits: 20_000n,
      },
    });
    expect(evaluateOriginationDecision(boundary).reasonCodes).not.toContain(
      "EXPOSURE_LIMIT_EXCEEDED",
    );
    const exceeded = evaluateOriginationDecision(
      input({
        exposure: {
          outstandingPrincipalMinorUnits: 10_001n,
          maximumOutstandingPrincipalMinorUnits: 20_000n,
        },
      }),
    );
    expect(exceeded.status).toBe("NOT_ELIGIBLE");
    expect(exceeded.reasonCodes).toContain("EXPOSURE_LIMIT_EXCEEDED");
  });

  it("enforces employee, identity, application, and policy gates", () => {
    const result = evaluateOriginationDecision(
      input({
        employee: {
          active: false,
          verified: false,
          identityIntegrityResolved: false,
          tenureMonths: 30,
          statusVerifiedAt: "2026-10-11T12:00:00.000Z",
        },
        application: {
          ...input().application,
          principalMinorUnits: 21_000n,
          termDays: 0,
        },
      }),
    );
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        "APPLICATION_INVALID",
        "EMPLOYEE_INACTIVE",
        "EMPLOYEE_UNVERIFIED",
        "IDENTITY_INTEGRITY_UNRESOLVED",
        "EMPLOYER_LOAN_LIMIT_EXCEEDED",
        "PRODUCT_LOAN_LIMIT_EXCEEDED",
      ]),
    );
  });

  it("does not let an approval override bypass a mandatory identity gate", () => {
    expect(
      isOriginationAuthorized({
        status: "REVIEW_REQUIRED",
        reasonCodes: ["EMPLOYEE_UNVERIFIED"],
        override: { outcome: "APPROVED" },
      }),
    ).toBe(false);
  });

  it("does not turn approval consideration into automatic approval", () => {
    expect(
      isOriginationAuthorized({
        status: "APPROVAL_CONSIDERATION",
        reasonCodes: ["SCORE_APPROVAL_BAND"],
        override: null,
      }),
    ).toBe(false);
    expect(
      isOriginationAuthorized({
        status: "APPROVAL_CONSIDERATION",
        reasonCodes: ["SCORE_APPROVAL_BAND"],
        override: { outcome: "APPROVED" },
      }),
    ).toBe(true);
  });
});
