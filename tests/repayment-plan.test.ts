import { describe, expect, it } from "vitest";

import {
  addUtcCalendarMonths,
  allocateRepaymentOldestFirst,
  deriveInstallmentState,
  generateRepaymentSchedule,
} from "@/modules/repayment-plans/domain/repayment-plan";

describe("repayment plan", () => {
  it.each([1, 2, 3])("creates an exact %i-month schedule", (termMonths) => {
    const schedule = generateRepaymentSchedule({
      totalRepaymentMinorUnits: 1_001n,
      termMonths,
      originatedAt: new Date("2026-10-13T12:30:00.000Z"),
    });

    expect(schedule).toHaveLength(termMonths);
    expect(
      schedule.reduce((sum, item) => sum + item.amountMinorUnits, 0n),
    ).toBe(1_001n);
    expect(schedule.at(-1)?.amountMinorUnits).toBe(
      1_001n - (1_001n / BigInt(termMonths)) * BigInt(termMonths - 1),
    );
  });

  it("clamps month-end dates without drifting the schedule anchor", () => {
    const firstDueAt = new Date("2028-01-31T23:15:00.000Z");
    const schedule = generateRepaymentSchedule({
      totalRepaymentMinorUnits: 300n,
      termMonths: 3,
      originatedAt: new Date("2027-12-31T23:15:00.000Z"),
      firstDueAt,
    });

    expect(schedule.map((item) => item.dueAt.toISOString())).toEqual([
      "2028-01-31T23:15:00.000Z",
      "2028-02-29T23:15:00.000Z",
      "2028-03-31T23:15:00.000Z",
    ]);
    expect(addUtcCalendarMonths(firstDueAt, 1).toISOString()).toBe(
      "2028-02-29T23:15:00.000Z",
    );
  });

  it("allocates partial repayments oldest-first and rejects overpayment", () => {
    const installments = [
      { id: "one", sequence: 1, amountMinorUnits: 400n, paidMinorUnits: 150n },
      { id: "two", sequence: 2, amountMinorUnits: 400n, paidMinorUnits: 0n },
    ];
    expect(
      allocateRepaymentOldestFirst({
        repaymentAmountMinorUnits: 300n,
        installments,
      }),
    ).toEqual([
      { installmentId: "one", amountMinorUnits: 250n },
      { installmentId: "two", amountMinorUnits: 50n },
    ]);
    expect(() =>
      allocateRepaymentOldestFirst({
        repaymentAmountMinorUnits: 651n,
        installments,
      }),
    ).toThrow("exceeds");
  });

  it("does not classify a pending payment as missed", () => {
    expect(
      deriveInstallmentState({
        amountMinorUnits: 400n,
        paidMinorUnits: 0n,
        pendingMinorUnits: 400n,
        dueAt: new Date("2026-10-10T00:00:00.000Z"),
        now: new Date("2026-10-13T00:00:00.000Z"),
      }).state,
    ).toBe("PAYMENT_PENDING");
  });

  it("distinguishes due, overdue, partial, and resolved installments", () => {
    const dueAt = new Date("2026-10-13T12:00:00.000Z");
    expect(
      deriveInstallmentState({
        amountMinorUnits: 400n,
        paidMinorUnits: 0n,
        dueAt,
        now: dueAt,
      }).state,
    ).toBe("DUE");
    expect(
      deriveInstallmentState({
        amountMinorUnits: 400n,
        paidMinorUnits: 0n,
        dueAt,
        now: new Date("2026-10-14T12:00:00.001Z"),
        gracePeriodMs: 86_400_000,
      }).state,
    ).toBe("OVERDUE");
    expect(
      deriveInstallmentState({
        amountMinorUnits: 400n,
        paidMinorUnits: 150n,
        dueAt,
        now: new Date("2026-10-15T12:00:00.000Z"),
      }),
    ).toMatchObject({ state: "PARTIALLY_PAID", outstandingMinorUnits: 250n });
    expect(
      deriveInstallmentState({
        amountMinorUnits: 400n,
        paidMinorUnits: 400n,
        dueAt,
        now: new Date("2026-10-15T12:00:00.000Z"),
      }).state,
    ).toBe("RESOLVED");
  });
});
