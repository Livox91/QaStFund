import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EmploymentStatus } from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { prismaAuthRepository } from "@/modules/auth/infrastructure/prisma-auth-repository";
import { synchronizeOrganizationEmployees } from "@/modules/employee-directory/application/synchronize-employees";
import type { EmployeeDirectoryAdapter } from "@/modules/employee-directory/domain/employee-directory";
import { prismaEmployeeDirectoryRepository } from "@/modules/employee-directory/infrastructure/prisma-employee-directory-repository";
import type { Clock } from "@/shared/time/clock";

const organizationA = randomUUID();
const organizationB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const sharedEmail = `${randomUUID()}@example.test`;
const now = new Date("2026-10-04T12:00:00.000Z");
const clock: Clock = { now: () => now };

function adapter(): EmployeeDirectoryAdapter {
  return {
    testConnection: vi.fn(
      async () =>
        ({
          ok: true,
          messageCode: "CONNECTION_OK",
        }) as const,
    ),
    listEmployees: vi.fn(async () => ({
      employees: [
        {
          externalId: "EMP-SHARED",
          employeeCode: "EMP-SHARED",
          fullName: "Organization A employee",
          email: sharedEmail,
          employmentStatus: "Inactive",
        },
      ],
    })),
    getEmployee: vi.fn(async () => null),
  };
}

describe("ERPNext employee synchronization database isolation", () => {
  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        {
          id: organizationA,
          name: "ERP sync A",
          slug: `erp-a-${organizationA}`,
        },
        {
          id: organizationB,
          name: "ERP sync B",
          slug: `erp-b-${organizationB}`,
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: userA,
          email: sharedEmail,
          name: "Employee A",
          passwordHash: "test-only",
        },
        {
          id: userB,
          email: `b-${sharedEmail}`,
          name: "Employee B",
          passwordHash: "test-only",
        },
      ],
    });
    await prisma.organizationMembership.createMany({
      data: [
        { organizationId: organizationA, userId: userA, role: "EMPLOYEE" },
        { organizationId: organizationB, userId: userB, role: "EMPLOYEE" },
      ],
    });
    await prismaEmployeeDirectoryRepository.saveIntegration({
      organizationId: organizationA,
      baseUrl: "https://erp.example.test",
      apiPath: "/api/resource",
      apiVersion: "v1",
      authMethod: "token",
      credentialReference: "test-only-reference",
      timeoutMs: 1000,
      statusMapping: { inactive: EmploymentStatus.SUSPENDED },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationA, organizationB] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await prisma.$disconnect();
  });

  it("keeps mappings tenant-scoped and prevents duplicates on repeat sync", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await synchronizeOrganizationEmployees(
        {
          organizationId: organizationA,
          trigger: "scheduled",
          staleAfterMs: 30 * 60_000,
        },
        prismaEmployeeDirectoryRepository,
        adapter,
        clock,
      );
    }

    const [mappingA, mappingB, membershipA, membershipB] = await Promise.all([
      prisma.employeeDirectoryMapping.count({
        where: {
          organizationId: organizationA,
          externalEmployeeId: "EMP-SHARED",
        },
      }),
      prisma.employeeDirectoryMapping.count({
        where: { organizationId: organizationB },
      }),
      prisma.organizationMembership.findUniqueOrThrow({
        where: {
          organizationId_userId: {
            organizationId: organizationA,
            userId: userA,
          },
        },
      }),
      prisma.organizationMembership.findUniqueOrThrow({
        where: {
          organizationId_userId: {
            organizationId: organizationB,
            userId: userB,
          },
        },
      }),
    ]);

    expect(mappingA).toBe(1);
    expect(mappingB).toBe(0);
    expect(membershipA.employmentStatus).toBe(EmploymentStatus.SUSPENDED);
    expect(membershipB.employmentStatus).toBe(EmploymentStatus.ACTIVE);
  });

  it("preserves historical account access after employment deactivation", async () => {
    const tokenHash = "a".repeat(64);
    const user =
      await prismaAuthRepository.findUserForAuthentication(sharedEmail);
    expect(user?.memberships).toHaveLength(1);

    await prismaAuthRepository.createSession({
      tokenHash,
      userId: userA,
      organizationId: organizationA,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await expect(
      prismaAuthRepository.findActorBySessionTokenHash(tokenHash, now),
    ).resolves.toMatchObject({ userId: userA, organizationId: organizationA });
  });

  it("marks an abandoned run failed and restarts from a complete snapshot", async () => {
    const integration =
      await prisma.employeeDirectoryIntegration.findUniqueOrThrow({
        where: { organizationId: organizationA },
      });
    const abandoned = await prisma.employeeDirectorySyncRun.create({
      data: {
        organizationId: organizationA,
        integrationId: integration.id,
        trigger: "SCHEDULED",
        correlationId: randomUUID(),
        startedAt: new Date(now.getTime() - 31 * 60_000),
      },
    });

    await synchronizeOrganizationEmployees(
      {
        organizationId: organizationA,
        trigger: "scheduled",
        staleAfterMs: 30 * 60_000,
      },
      prismaEmployeeDirectoryRepository,
      adapter,
      clock,
    );

    await expect(
      prisma.employeeDirectorySyncRun.findUniqueOrThrow({
        where: { id: abandoned.id },
        select: { status: true, safeErrorSummary: true },
      }),
    ).resolves.toEqual({
      status: "FAILED",
      safeErrorSummary:
        "The previous synchronization stopped before completion.",
    });
  });

  it("rejects an overlapping PostgreSQL-backed run for the same organization", async () => {
    const first = await prismaEmployeeDirectoryRepository.claimSync({
      organizationId: organizationA,
      trigger: "scheduled",
      correlationId: randomUUID(),
      startedAt: now,
      staleBefore: new Date(now.getTime() - 30 * 60_000),
    });
    expect(first.kind).toBe("claimed");

    await expect(
      prismaEmployeeDirectoryRepository.claimSync({
        organizationId: organizationA,
        trigger: "scheduled",
        correlationId: randomUUID(),
        startedAt: now,
        staleBefore: new Date(now.getTime() - 30 * 60_000),
      }),
    ).resolves.toEqual({ kind: "concurrent" });

    if (first.kind === "claimed") {
      await prismaEmployeeDirectoryRepository.failSync({
        organizationId: organizationA,
        runId: first.runId,
        safeErrorCode: "UNEXPECTED_ERROR",
        safeErrorSummary: "Test cleanup.",
        completedAt: now,
        durationMs: 0,
      });
    }
  });

  it("schedules only organizations that explicitly enable ERPNext", async () => {
    await prisma.organization.update({
      where: { id: organizationA },
      data: { erpNextEnabled: false },
    });
    await expect(
      prismaEmployeeDirectoryRepository.listScheduledOrganizations({
        dueBefore: new Date("2030-01-01T00:00:00.000Z"),
      }),
    ).resolves.not.toContain(organizationA);

    await prisma.organization.update({
      where: { id: organizationA },
      data: { erpNextEnabled: true },
    });
    await expect(
      prismaEmployeeDirectoryRepository.listScheduledOrganizations({
        dueBefore: new Date("2030-01-01T00:00:00.000Z"),
      }),
    ).resolves.toContain(organizationA);
  });
});
