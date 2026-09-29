import { describe, expect, it } from "vitest";

import {
  DEFAULT_LENDING_POLICY,
  OBLIGATION_LOAN_STATUSES,
  calculateBorrowingCapacity,
  validateBorrowAgainstPolicy,
  validateOfferAgainstPolicy,
  validatePolicyConfiguration,
} from "@/modules/policies/domain/lending-policy";
import { lendingPolicySchema } from "@/modules/policies/schemas/lending-policy.schema";

describe("organization lending policy", () => {
  it("centralizes safe defaults", () => {
    expect(DEFAULT_LENDING_POLICY).toEqual({
      lendingEnabled: true,
      borrowingEnabled: true,
      maxLoanAmountMinorUnits: 10_000n,
      maxOutstandingDebtMinorUnits: 25_000n,
      maxActiveLoans: 3,
      minInterestRateBasisPoints: 0,
      maxInterestRateBasisPoints: 500,
      minTermDays: 7,
      maxTermDays: 60,
    });
  });

  it("rejects invalid policy combinations", () => {
    expect(
      validatePolicyConfiguration({
        ...DEFAULT_LENDING_POLICY,
        maxLoanAmountMinorUnits: 0n,
      }),
    ).toBe(false);
    expect(
      validatePolicyConfiguration({
        ...DEFAULT_LENDING_POLICY,
        maxOutstandingDebtMinorUnits: 9_999n,
      }),
    ).toBe(false);
    expect(
      validatePolicyConfiguration({
        ...DEFAULT_LENDING_POLICY,
        maxActiveLoans: 0,
      }),
    ).toBe(false);
    expect(
      validatePolicyConfiguration({
        ...DEFAULT_LENDING_POLICY,
        minInterestRateBasisPoints: 600,
      }),
    ).toBe(false);
    expect(
      validatePolicyConfiguration({
        ...DEFAULT_LENDING_POLICY,
        minTermDays: 61,
      }),
    ).toBe(false);
  });

  it.each([
    [
      "below interest minimum",
      { feeRateBasisPoints: 99, durationDays: 30 },
      "INTEREST_OUT_OF_RANGE",
    ],
    [
      "above interest maximum",
      { feeRateBasisPoints: 501, durationDays: 30 },
      "INTEREST_OUT_OF_RANGE",
    ],
    [
      "below term minimum",
      { feeRateBasisPoints: 300, durationDays: 6 },
      "TERM_OUT_OF_RANGE",
    ],
    [
      "above term maximum",
      { feeRateBasisPoints: 300, durationDays: 61 },
      "TERM_OUT_OF_RANGE",
    ],
  ] as const)("rejects offer %s", (_label, offer, violation) => {
    const policy = {
      ...DEFAULT_LENDING_POLICY,
      minInterestRateBasisPoints: 100,
    };
    expect(validateOfferAgainstPolicy(policy, { canLend: true }, offer)).toBe(
      violation,
    );
  });

  it("enforces kill switches and employee lending access", () => {
    expect(
      validateOfferAgainstPolicy(
        { ...DEFAULT_LENDING_POLICY, lendingEnabled: false },
        { canLend: true },
        { feeRateBasisPoints: 300, durationDays: 30 },
      ),
    ).toBe("LENDING_DISABLED");
    expect(
      validateOfferAgainstPolicy(
        DEFAULT_LENDING_POLICY,
        { canLend: false },
        { feeRateBasisPoints: 300, durationDays: 30 },
      ),
    ).toBe("EMPLOYEE_CANNOT_LEND");
  });

  it.each([
    [
      "maximum loan",
      {
        amountMinorUnits: 10_001n,
        outstandingDebtMinorUnits: 0n,
        activeLoans: 0,
      },
      "MAX_LOAN_EXCEEDED",
    ],
    [
      "debt capacity",
      {
        amountMinorUnits: 10_000n,
        outstandingDebtMinorUnits: 20_000n,
        activeLoans: 1,
      },
      "OUTSTANDING_DEBT_EXCEEDED",
    ],
    [
      "active loan count",
      {
        amountMinorUnits: 1_000n,
        outstandingDebtMinorUnits: 1_000n,
        activeLoans: 3,
      },
      "ACTIVE_LOAN_LIMIT_REACHED",
    ],
  ] as const)("enforces borrower %s", (_label, input, violation) => {
    expect(
      validateBorrowAgainstPolicy(
        DEFAULT_LENDING_POLICY,
        { canBorrow: true },
        input,
      ),
    ).toBe(violation);
  });

  it("calculates capacity from server-side obligations", () => {
    expect(
      calculateBorrowingCapacity(
        DEFAULT_LENDING_POLICY,
        { canBorrow: true },
        { outstandingDebtMinorUnits: 18_000n, activeLoans: 2 },
      ),
    ).toMatchObject({
      remainingDebtCapacityMinorUnits: 7_000n,
      activeLoans: 2,
      eligible: true,
    });
  });

  it("counts active, overdue, and defaulted obligations", () => {
    expect(OBLIGATION_LOAN_STATUSES).toEqual([
      "ACTIVE",
      "OVERDUE",
      "DEFAULTED",
    ]);
    expect(OBLIGATION_LOAN_STATUSES).not.toContain("REPAID");
    expect(OBLIGATION_LOAN_STATUSES).not.toContain("CANCELLED");
  });

  it("parses money and rates without floating-point arithmetic", () => {
    const parsed = lendingPolicySchema.parse({
      lendingEnabled: true,
      borrowingEnabled: true,
      maxLoanAmount: "100.00",
      maxOutstandingDebt: "250.00",
      maxActiveLoans: 3,
      minInterestRate: "0",
      maxInterestRate: "5.00",
      minTermDays: 7,
      maxTermDays: 60,
    });
    expect(parsed.maxLoanAmount).toBe(10_000n);
    expect(parsed.maxInterestRate).toBe(500);
  });
});
