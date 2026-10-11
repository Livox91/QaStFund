import { describe, expect, it } from "vitest";

import { evaluateEmployeeDirectoryEligibility } from "@/modules/employee-directory/domain/employee-eligibility";

const now = new Date("2026-10-11T12:00:00.000Z");

function eligibility(
  overrides: Partial<
    Parameters<typeof evaluateEmployeeDirectoryEligibility>[0]
  > = {},
) {
  return evaluateEmployeeDirectoryEligibility({
    erpNextEnabled: true,
    integration: {
      lastSyncStatus: "SUCCESS",
      lastSuccessfulSyncAt: new Date("2026-10-11T11:30:00.000Z"),
    },
    employee: {
      employmentStatusSource: "ERPNEXT",
      employmentStatusSyncedAt: new Date("2026-10-11T11:30:00.000Z"),
    },
    now,
    maxAgeMs: 60 * 60_000,
    ...overrides,
  });
}

describe("ERPNext eligibility freshness", () => {
  it("trusts a member from the latest complete snapshot", () => {
    expect(eligibility()).toEqual({
      trusted: true,
      reason: "DIRECTORY_TRUSTED",
    });
  });

  it.each(["PARTIAL", "FAILED", "RUNNING"] as const)(
    "fails closed after a %s synchronization",
    (lastSyncStatus) => {
      expect(
        eligibility({
          integration: {
            lastSyncStatus,
            lastSuccessfulSyncAt: new Date("2026-10-11T11:30:00.000Z"),
          },
        }),
      ).toEqual({
        trusted: false,
        reason: "DIRECTORY_SYNC_INCOMPLETE",
      });
    },
  );

  it("fails closed when the last complete snapshot is stale", () => {
    expect(
      eligibility({
        integration: {
          lastSyncStatus: "SUCCESS",
          lastSuccessfulSyncAt: new Date("2026-10-11T10:59:59.999Z"),
        },
      }),
    ).toEqual({ trusted: false, reason: "DIRECTORY_SYNC_STALE" });
  });

  it("does not trust a manual or older employee status in an ERPNext organization", () => {
    expect(
      eligibility({
        employee: {
          employmentStatusSource: "MANUAL",
          employmentStatusSyncedAt: null,
        },
      }),
    ).toEqual({
      trusted: false,
      reason: "EMPLOYEE_STATUS_NOT_SYNCHRONIZED",
    });
  });

  it("does not impose ERPNext freshness when the organization disables it", () => {
    expect(
      eligibility({
        erpNextEnabled: false,
        integration: null,
        employee: {
          employmentStatusSource: null,
          employmentStatusSyncedAt: null,
        },
      }),
    ).toEqual({ trusted: true, reason: "DIRECTORY_NOT_REQUIRED" });
  });
});
