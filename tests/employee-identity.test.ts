import { describe, expect, it, vi } from "vitest";

import { getEmployeeIdentity } from "@/modules/employees/application/get-employee-identity";
import type { EmployeeIdentityRepository } from "@/modules/employees/application/ports/employee-identity-repository";
import { ApplicationRole } from "@/modules/auth/domain/application-role";

const now = new Date("2026-09-29T12:00:00.000Z");
const alice = {
  userId: "c469039d-e6a0-4dca-adbe-090f84b567ce",
  email: "alice@acme.test",
  name: "Alice Carter",
  organizationId: "b5ed8fa5-ad58-4458-8e4a-c2f328e9203d",
  organizationName: "Acme Corp",
  organizationSlug: "acme-corp",
  role: ApplicationRole.EMPLOYEE,
} as const;

describe("employee identity", () => {
  it("projects the authenticated application user, membership, and wallet", async () => {
    const repository: EmployeeIdentityRepository = {
      findForEmployee: vi.fn(async () => ({
        userId: alice.userId,
        organizationId: alice.organizationId,
        name: alice.name,
        email: alice.email,
        walletAddress: "0x7EE89F2BE8C1E15C92B4577B3BE3A0BDDB5CA957",
        walletStatus: "ACTIVE" as const,
        employmentStatus: "ACTIVE" as const,
        createdAt: now,
        updatedAt: now,
      })),
    };

    await expect(getEmployeeIdentity(alice, repository)).resolves.toEqual({
      id: alice.userId,
      organizationId: alice.organizationId,
      name: alice.name,
      email: alice.email,
      walletAddress: "0x7ee89f2be8c1e15c92b4577b3be3a0bddb5ca957",
      walletStatus: "ready",
      employmentStatus: "active",
      createdAt: now,
      updatedAt: now,
    });
    expect(repository.findForEmployee).toHaveBeenCalledWith({
      organizationId: alice.organizationId,
      userId: alice.userId,
    });
  });

  it("represents an employee without a wallet without inventing an address", async () => {
    const repository: EmployeeIdentityRepository = {
      findForEmployee: vi.fn(async () => ({
        userId: alice.userId,
        organizationId: alice.organizationId,
        name: alice.name,
        email: alice.email,
        walletAddress: null,
        walletStatus: null,
        employmentStatus: "SUSPENDED" as const,
        createdAt: now,
        updatedAt: now,
      })),
    };

    const employee = await getEmployeeIdentity(alice, repository);

    expect(employee).toMatchObject({
      id: alice.userId,
      walletStatus: "not_created",
      employmentStatus: "suspended",
    });
    expect(employee).not.toHaveProperty("walletAddress");
  });
});
