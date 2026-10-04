import { describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import {
  getEmployerOnboarding,
  setEmployerErpNextEnabled,
  startInitialEmployeeSynchronization,
  updateEmployerOrganizationName,
} from "@/modules/organizations/application/employer-onboarding";
import type {
  EmployerOnboardingRepository,
  EmployerOnboardingSnapshot,
} from "@/modules/organizations/application/ports/employer-onboarding-repository";
import {
  DEFAULT_LENDING_POLICY,
  validatePolicyConfiguration,
} from "@/modules/policies/domain/lending-policy";
import { lendingPolicySchema } from "@/modules/policies/schemas/lending-policy.schema";

const admin: AuthenticatedActor = {
  userId: "admin-a",
  email: "admin@a.test",
  name: "Admin A",
  organizationId: "organization-a",
  organizationName: "Organization A",
  organizationSlug: "organization-a",
  role: ApplicationRole.EMPLOYER_ADMIN,
};

function snapshot(
  overrides: Partial<EmployerOnboardingSnapshot> = {},
): EmployerOnboardingSnapshot {
  return {
    organization: {
      id: "organization-a",
      name: "Organization A",
      slug: "organization-a",
      erpNextEnabled: false,
    },
    activeEmployerAdminCount: 1,
    employeeCount: 0,
    policy: null,
    erpNext: null,
    ...overrides,
  };
}

function repository(value = snapshot()): EmployerOnboardingRepository {
  return {
    getSnapshot: vi.fn(async () => value),
    updateOrganizationName: vi.fn(async () => true),
    setErpNextEnabled: vi.fn(async () => true),
  };
}

describe("employer onboarding", () => {
  it("reports an incomplete setup without mutating configuration", async () => {
    const store = repository();
    await expect(
      getEmployerOnboarding(admin, store, false),
    ).resolves.toMatchObject({
      readyForPilot: false,
      checklist: {
        organizationProfile: true,
        employerAdmin: true,
        employeeDirectory: false,
        lendingPolicy: false,
        blockchainTestnet: false,
        erpNext: true,
      },
    });
    expect(store.updateOrganizationName).not.toHaveBeenCalled();
  });

  it("reports completion only when all required setup is available", async () => {
    const store = repository(
      snapshot({
        organization: {
          id: "organization-a",
          name: "Organization A",
          slug: "organization-a",
          erpNextEnabled: true,
        },
        employeeCount: 2,
        policy: DEFAULT_LENDING_POLICY,
        erpNext: {
          connectionStatus: "connected",
          lastSuccessfulSyncAt: new Date("2026-10-04T12:00:00.000Z"),
          latestSync: null,
        },
      }),
    );
    await expect(
      getEmployerOnboarding(admin, store, true),
    ).resolves.toMatchObject({
      readyForPilot: true,
    });
  });

  it("requires a connected ERPNext integration only when enabled", async () => {
    const store = repository(
      snapshot({
        organization: {
          id: "organization-a",
          name: "Organization A",
          slug: "organization-a",
          erpNextEnabled: true,
        },
        erpNext: {
          connectionStatus: "failed",
          lastSuccessfulSyncAt: null,
          latestSync: null,
        },
      }),
    );
    const setup = await getEmployerOnboarding(admin, store, true);
    expect(setup.checklist.erpNext).toBe(false);
    expect(setup.readyForPilot).toBe(false);
  });

  it("derives organization scope from the authenticated administrator", async () => {
    const store = repository();
    await updateEmployerOrganizationName(admin, "Renamed", store);
    await setEmployerErpNextEnabled(admin, true, store);
    expect(store.updateOrganizationName).toHaveBeenCalledWith({
      organizationId: "organization-a",
      actorUserId: "admin-a",
      name: "Renamed",
    });
    expect(store.setErpNextEnabled).toHaveBeenCalledWith({
      organizationId: "organization-a",
      actorUserId: "admin-a",
      enabled: true,
    });
  });

  it("rejects employee access before the repository is called", async () => {
    const store = repository();
    await expect(
      getEmployerOnboarding(
        { ...admin, role: ApplicationRole.EMPLOYEE },
        store,
        true,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.getSnapshot).not.toHaveBeenCalled();
  });

  it("reuses the existing employee synchronization only when ERPNext is ready", async () => {
    const synchronize = vi.fn(async () => ({ status: "success" as const }));
    await expect(
      startInitialEmployeeSynchronization(admin, repository(), synchronize),
    ).rejects.toThrow("ERP_NEXT_NOT_READY");
    expect(synchronize).not.toHaveBeenCalled();

    const enabled = repository(
      snapshot({
        organization: {
          id: "organization-a",
          name: "Organization A",
          slug: "organization-a",
          erpNextEnabled: true,
        },
        erpNext: {
          connectionStatus: "connected",
          lastSuccessfulSyncAt: null,
          latestSync: null,
        },
      }),
    );
    await expect(
      startInitialEmployeeSynchronization(admin, enabled, synchronize),
    ).resolves.toEqual({ status: "success" });
    expect(synchronize).toHaveBeenCalledWith(admin);
  });

  it("rejects invalid policy ranges and inconsistent minimums and maximums", () => {
    expect(
      lendingPolicySchema.safeParse({
        lendingEnabled: true,
        borrowingEnabled: true,
        maxLoanAmount: "-1",
        maxOutstandingDebt: "100",
        maxActiveLoans: 0,
        minInterestRate: "1",
        maxInterestRate: "2",
        minTermDays: 1,
        maxTermDays: 30,
      }).success,
    ).toBe(false);
    expect(
      validatePolicyConfiguration({
        ...DEFAULT_LENDING_POLICY,
        maxLoanAmountMinorUnits: 20_000n,
        maxOutstandingDebtMinorUnits: 10_000n,
        minTermDays: 60,
        maxTermDays: 30,
      }),
    ).toBe(false);
  });
});
