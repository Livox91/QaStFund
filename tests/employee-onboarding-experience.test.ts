import { describe, expect, it } from "vitest";

import type { ArcWallet } from "@/modules/arc-wallet/domain/arc-wallet";
import { getEmployeeOnboardingState } from "@/modules/employees/domain/employee-onboarding";
import type { Employee } from "@/modules/employees/domain/employee";
import type { BorrowingCapacity } from "@/modules/policies/domain/lending-policy";
import {
  clearPendingOperation,
  readPendingOperation,
  writePendingOperation,
} from "@/modules/transactions/browser-pending-operation";

const employee: Employee = {
  id: "employee-a",
  organizationId: "organization-a",
  name: "Employee A",
  email: "employee@example.test",
  walletStatus: "not_created",
  employmentStatus: "active",
  createdAt: new Date("2026-10-04T00:00:00.000Z"),
  updatedAt: new Date("2026-10-04T00:00:00.000Z"),
};

const capacity: BorrowingCapacity = {
  maxLoanAmountMinorUnits: 10_000n,
  maxOutstandingDebtMinorUnits: 25_000n,
  outstandingDebtMinorUnits: 0n,
  remainingDebtCapacityMinorUnits: 25_000n,
  activeLoans: 0,
  maxActiveLoans: 3,
  lendingEnabled: true,
  borrowingEnabled: true,
  employeeCanBorrow: true,
  eligible: true,
};

function wallet(overrides: Partial<ArcWallet> = {}): ArcWallet {
  return {
    id: "wallet-a",
    organizationId: "organization-a",
    userId: "employee-a",
    address: "0x1111111111111111111111111111111111111111",
    network: "ARC_TESTNET",
    chainId: 5_042_002,
    walletType: "CIRCLE_MODULAR",
    status: "ACTIVE",
    enrollmentState: "ACTIVE",
    createdAt: new Date("2026-10-04T00:00:00.000Z"),
    updatedAt: new Date("2026-10-04T00:00:00.000Z"),
    ...overrides,
  };
}

describe("employee first-use status", () => {
  it("requires wallet setup before an otherwise eligible employee is ready", () => {
    expect(
      getEmployeeOnboardingState({ employee, wallet: null, capacity }),
    ).toMatchObject({
      wallet: "setup_required",
      eligibility: "eligible",
      readyToUse: false,
      nextAction: "setup_wallet",
    });
  });

  it("distinguishes pending, recoverable, ready, and ineligible states", () => {
    expect(
      getEmployeeOnboardingState({
        employee,
        wallet: wallet({ status: "PENDING", enrollmentState: "VERIFYING" }),
        capacity,
      }).wallet,
    ).toBe("pending");
    expect(
      getEmployeeOnboardingState({
        employee,
        wallet: wallet({
          status: "FAILED",
          enrollmentState: "FAILED_RECOVERABLE",
        }),
        capacity,
      }),
    ).toMatchObject({
      wallet: "recovery_required",
      nextAction: "recover_wallet",
    });
    expect(
      getEmployeeOnboardingState({ employee, wallet: wallet(), capacity }),
    ).toMatchObject({ readyToUse: true, nextAction: "browse_offers" });
    expect(
      getEmployeeOnboardingState({
        employee: { ...employee, employmentStatus: "suspended" },
        wallet: wallet(),
        capacity: { ...capacity, employeeCanBorrow: false, eligible: false },
      }),
    ).toMatchObject({
      profile: "ineligible",
      eligibility: "ineligible",
      readyToUse: false,
      nextAction: "contact_employer",
    });
  });
});

describe("browser transaction recovery", () => {
  it("persists a submitted transaction for confirmation after interruption", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    writePendingOperation(storage, {
      kind: "loan_acceptance",
      referenceId: "offer-a",
      requestId: "request-a",
      operationId: "loan-a",
      transactionHash: `0x${"a".repeat(64)}`,
    });
    expect(
      readPendingOperation(storage, "loan_acceptance", "offer-a"),
    ).toMatchObject({
      requestId: "request-a",
      operationId: "loan-a",
      transactionHash: `0x${"a".repeat(64)}`,
    });
    expect(readPendingOperation(storage, "repayment", "offer-a")).toBeNull();
    clearPendingOperation(storage, "loan_acceptance", "offer-a");
    expect(
      readPendingOperation(storage, "loan_acceptance", "offer-a"),
    ).toBeNull();
  });
});
