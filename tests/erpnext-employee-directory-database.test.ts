import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { EmploymentStatus } from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { ApplicationRole } from "@/modules/auth/domain/application-role";
import { prismaAuthRepository } from "@/modules/auth/infrastructure/prisma-auth-repository";
import { synchronizeOrganizationEmployees } from "@/modules/employee-directory/application/synchronize-employees";
import type { EmployeeDirectoryAdapter } from "@/modules/employee-directory/domain/employee-directory";
import { prismaEmployeeDirectoryRepository } from "@/modules/employee-directory/infrastructure/prisma-employee-directory-repository";
import {
  acceptInvitation,
  changePassword,
  requestPasswordReset,
  resetPassword,
  resendInvitation,
} from "@/modules/employee-invitations/infrastructure/invitation-service";
import type {
  EmailMessage,
  EmailSender,
} from "@/modules/notifications/domain/email";
import { scryptPasswordHasher } from "@/modules/auth/infrastructure/scrypt-password-hasher";
import {
  PrismaEncryptedEmployeeDirectorySecretProvider,
  storeEncryptedEmployeeDirectorySecret,
} from "@/modules/employee-directory/infrastructure/encrypted-secret-provider";
import type { Clock } from "@/shared/time/clock";

const organizationA = randomUUID();
const organizationB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const adminUser = randomUUID();
const sharedEmail = `${randomUUID()}@example.test`;
const newEmployeeEmail = `${randomUUID()}@example.test`;
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

function activeEmployeeAdapter(input: {
  externalId: string;
  email: string;
  fullName: string;
}): EmployeeDirectoryAdapter {
  return {
    testConnection: vi.fn(
      async () => ({ ok: true, messageCode: "CONNECTION_OK" }) as const,
    ),
    listEmployees: vi.fn(async () => ({
      employees: [{ ...input, employmentStatus: "Active" }],
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
        {
          id: adminUser,
          email: `admin-${sharedEmail}`,
          name: "Admin A",
          passwordHash: "test-only",
        },
      ],
    });
    await prisma.organizationMembership.createMany({
      data: [
        { organizationId: organizationA, userId: userA, role: "EMPLOYEE" },
        { organizationId: organizationB, userId: userB, role: "EMPLOYEE" },
        {
          organizationId: organizationA,
          userId: adminUser,
          role: "EMPLOYER_ADMIN",
        },
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
      statusMapping: {
        active: EmploymentStatus.ACTIVE,
        inactive: EmploymentStatus.SUSPENDED,
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationA, organizationB] } },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: [userA, userB, adminUser] } },
          { email: newEmployeeEmail },
        ],
      },
    });
    await prisma.$disconnect();
  });

  it("keeps mappings tenant-scoped and prevents duplicates on repeat sync", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
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

  it("revokes application access after employment deactivation", async () => {
    const tokenHash = randomBytes(32).toString("hex");
    const user =
      await prismaAuthRepository.findUserForAuthentication(sharedEmail);
    expect(user?.memberships).toHaveLength(0);

    await prismaAuthRepository.createSession({
      tokenHash,
      userId: userA,
      organizationId: organizationA,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await expect(
      prismaAuthRepository.findActorBySessionTokenHash(tokenHash, now),
    ).resolves.toBeNull();
  });

  it("creates a new employee once, keeps the stable ERP identity, and reactivates the same record", async () => {
    const sentMessages: EmailMessage[] = [];
    const sender: EmailSender = {
      send: vi.fn(async (message) => {
        sentMessages.push(message);
      }),
    };
    const externalId = `EMP-NEW-${randomUUID()}`;
    const first = activeEmployeeAdapter({
      externalId,
      email: newEmployeeEmail,
      fullName: "New ERP Employee",
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await synchronizeOrganizationEmployees(
        {
          organizationId: organizationA,
          trigger: "scheduled",
          staleAfterMs: 30 * 60_000,
        },
        prismaEmployeeDirectoryRepository,
        () => first,
        clock,
        { sender, appUrl: "https://p2p.example.test" },
      );
    }
    const mapping = await prisma.employeeDirectoryMapping.findFirstOrThrow({
      where: { organizationId: organizationA, externalEmployeeId: externalId },
    });
    expect(mapping.matchedMembershipId).not.toBeNull();
    expect(sentMessages).toHaveLength(1);
    const pendingInvitation = await prisma.employeeInvitation.findFirstOrThrow({
      where: {
        organizationId: organizationA,
        employeeMembershipId: mapping.matchedMembershipId!,
      },
      select: { tokenHash: true, deliveryStatus: true },
    });
    expect(pendingInvitation.tokenHash).toHaveLength(64);
    expect(pendingInvitation.deliveryStatus).toBe("SENT");
    await expect(
      prisma.employeeDirectorySyncRun.aggregate({
        where: { organizationId: organizationA },
        _sum: {
          invitationCreatedCount: true,
          invitationSentCount: true,
          invitationFailureCount: true,
        },
      }),
    ).resolves.toMatchObject({
      _sum: {
        invitationCreatedCount: 1,
        invitationSentCount: 1,
        invitationFailureCount: 0,
      },
    });
    expect(
      await prisma.employeeInvitation.count({
        where: {
          organizationId: organizationA,
          employeeMembershipId: mapping.matchedMembershipId!,
        },
      }),
    ).toBe(1);
    await expect(
      prisma.organizationMembership.findUniqueOrThrow({
        where: { id: mapping.matchedMembershipId! },
        select: { isActive: true, accountActivatedAt: true },
      }),
    ).resolves.toEqual({ isActive: false, accountActivatedAt: null });
    const firstInvitationToken =
      sentMessages[0].text.match(/invite\/([^\s]+)/)?.[1];
    expect(firstInvitationToken).toBeTruthy();
    expect(pendingInvitation.tokenHash).not.toBe(firstInvitationToken);
    await expect(
      resendInvitation({
        actor: {
          userId: userB,
          email: `b-${sharedEmail}`,
          name: "Cross-tenant actor",
          organizationId: organizationB,
          organizationName: "ERP sync B",
          organizationSlug: `erp-b-${organizationB}`,
          role: ApplicationRole.EMPLOYER_ADMIN,
        },
        membershipId: mapping.matchedMembershipId!,
        sender,
        appUrl: "https://p2p.example.test",
        now,
      }),
    ).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_TOKEN" });
    expect(sentMessages).toHaveLength(1);
    await resendInvitation({
      actor: {
        userId: adminUser,
        email: `admin-${sharedEmail}`,
        name: "Admin A",
        organizationId: organizationA,
        organizationName: "ERP sync A",
        organizationSlug: `erp-a-${organizationA}`,
        role: ApplicationRole.EMPLOYER_ADMIN,
      },
      membershipId: mapping.matchedMembershipId!,
      sender,
      appUrl: "https://p2p.example.test",
      now,
    });
    expect(sentMessages).toHaveLength(2);
    const invitationToken = sentMessages[1].text.match(/invite\/([^\s]+)/)?.[1];
    await expect(
      acceptInvitation({
        token: firstInvitationToken!,
        email: newEmployeeEmail,
        password: "SecurePassword123!",
        now,
      }),
    ).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_TOKEN" });
    await expect(
      acceptInvitation({
        token: invitationToken!,
        email: `wrong-${newEmployeeEmail}`,
        password: "SecurePassword123!",
        now,
      }),
    ).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_TOKEN" });
    const authentication = await acceptInvitation({
      token: invitationToken!,
      email: newEmployeeEmail,
      password: "SecurePassword123!",
      now,
    });
    await expect(
      acceptInvitation({
        token: invitationToken!,
        email: newEmployeeEmail,
        password: "AnotherPassword123!",
        now,
      }),
    ).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_TOKEN" });
    expect(
      await prisma.organizationMembership.count({
        where: {
          organizationId: organizationA,
          user: { email: newEmployeeEmail },
        },
      }),
    ).toBe(1);
    const lenderMembership =
      await prisma.organizationMembership.findFirstOrThrow({
        where: { organizationId: organizationA, userId: userA },
        select: { id: true },
      });
    const transactionHash = `0x${randomBytes(32).toString("hex")}`;
    const loan = await prisma.loan.create({
      data: {
        organizationId: organizationA,
        lenderMembershipId: lenderMembership.id,
        borrowerMembershipId: mapping.matchedMembershipId!,
        principalAmountMinorUnits: 100_000_000n,
        outstandingPrincipalMinorUnits: 75_000_000n,
        feeAmountMinorUnits: 5_000_000n,
        currency: "USD",
        durationDays: 30,
        feeRateBasisPoints: 500,
        status: "ACTIVE",
        requestedAt: now,
        approvedAt: now,
        activatedAt: now,
        startedAt: now,
        repaymentDueAt: new Date("2026-11-03T12:00:00.000Z"),
        acceptanceTransactionHash: transactionHash,
        repayments: {
          create: {
            amountMinorUnits: 25_000_000n,
            currency: "USD",
            status: "COMPLETED",
            paidAt: now,
            completedAt: now,
          },
        },
      },
    });

    await synchronizeOrganizationEmployees(
      {
        organizationId: organizationA,
        trigger: "scheduled",
        staleAfterMs: 30 * 60_000,
      },
      prismaEmployeeDirectoryRepository,
      () => ({
        ...first,
        listEmployees: vi.fn(async () => ({ employees: [] })),
      }),
      clock,
      { sender, appUrl: "https://p2p.example.test" },
    );
    await expect(
      prisma.organizationMembership.findUniqueOrThrow({
        where: { id: mapping.matchedMembershipId! },
        select: { isActive: true, employmentStatus: true, removedAt: true },
      }),
    ).resolves.toMatchObject({
      isActive: false,
      employmentStatus: EmploymentStatus.TERMINATED,
      removedAt: now,
    });
    await expect(
      prisma.loan.findUniqueOrThrow({
        where: { id: loan.id },
        select: {
          status: true,
          outstandingPrincipalMinorUnits: true,
          acceptanceTransactionHash: true,
          repayments: {
            select: { amountMinorUnits: true, status: true },
          },
        },
      }),
    ).resolves.toEqual({
      status: "ACTIVE",
      outstandingPrincipalMinorUnits: 75_000_000n,
      acceptanceTransactionHash: transactionHash,
      repayments: [{ amountMinorUnits: 25_000_000n, status: "COMPLETED" }],
    });

    const renamed = activeEmployeeAdapter({
      externalId,
      email: newEmployeeEmail,
      fullName: "Rehired ERP Employee",
    });
    await synchronizeOrganizationEmployees(
      {
        organizationId: organizationA,
        trigger: "scheduled",
        staleAfterMs: 30 * 60_000,
      },
      prismaEmployeeDirectoryRepository,
      () => renamed,
      clock,
      { sender, appUrl: "https://p2p.example.test" },
    );
    await expect(
      prisma.organizationMembership.findUniqueOrThrow({
        where: { id: mapping.matchedMembershipId! },
        select: {
          id: true,
          isActive: true,
          employmentStatus: true,
          removedAt: true,
          user: { select: { name: true } },
        },
      }),
    ).resolves.toEqual({
      id: mapping.matchedMembershipId,
      isActive: true,
      employmentStatus: EmploymentStatus.ACTIVE,
      removedAt: null,
      user: { name: "Rehired ERP Employee" },
    });

    const employeeUser = await prisma.user.findUniqueOrThrow({
      where: { email: newEmployeeEmail },
      select: { id: true, passwordHash: true },
    });
    await prisma.session.create({
      data: {
        organizationId: organizationA,
        userId: employeeUser.id,
        tokenHash: createHash("sha256")
          .update(authentication.sessionToken)
          .digest("hex"),
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });
    await prisma.session.create({
      data: {
        organizationId: organizationA,
        userId: employeeUser.id,
        tokenHash: randomBytes(32).toString("hex"),
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });
    await changePassword({
      actor: {
        userId: employeeUser.id,
        email: newEmployeeEmail,
        name: "Rehired ERP Employee",
        organizationId: organizationA,
        organizationName: "ERP sync A",
        organizationSlug: `erp-a-${organizationA}`,
        role: ApplicationRole.EMPLOYEE,
      },
      currentPassword: "SecurePassword123!",
      newPassword: "ChangedPassword123!",
      currentSessionToken: authentication.sessionToken,
      now,
    });
    expect(
      await prisma.session.count({ where: { userId: employeeUser.id } }),
    ).toBe(1);
    expect(
      await scryptPasswordHasher.verify(
        "ChangedPassword123!",
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: employeeUser.id },
          })
        ).passwordHash,
      ),
    ).toBe(true);

    await requestPasswordReset({
      email: newEmployeeEmail,
      sender,
      appUrl: "https://p2p.example.test",
      now,
    });
    const resetToken = sentMessages
      .at(-1)
      ?.text.match(/reset-password\/([^\s]+)/)?.[1];
    await resetPassword({
      token: resetToken!,
      password: "ResetPassword123!",
      now,
    });
    await expect(
      resetPassword({
        token: resetToken!,
        password: "AnotherPassword123!",
        now,
      }),
    ).rejects.toMatchObject({ code: "INVALID_OR_EXPIRED_TOKEN" });
    expect(
      await prisma.session.count({ where: { userId: employeeUser.id } }),
    ).toBe(0);
    expect(
      await scryptPasswordHasher.verify(
        "ResetPassword123!",
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: employeeUser.id },
          })
        ).passwordHash,
      ),
    ).toBe(true);
    await expect(
      requestPasswordReset({
        email: newEmployeeEmail,
        sender: {
          send: vi.fn(async () =>
            Promise.reject(new Error("PROVIDER_REJECTED")),
          ),
        },
        appUrl: "https://p2p.example.test",
        now,
      }),
    ).rejects.toThrow("PROVIDER_REJECTED");
    await expect(
      prisma.passwordResetToken.findFirstOrThrow({
        where: { userId: employeeUser.id },
        orderBy: { createdAt: "desc" },
        select: { deliveryStatus: true, deliveryFailureCode: true },
      }),
    ).resolves.toEqual({
      deliveryStatus: "FAILED",
      deliveryFailureCode: "PROVIDER_REJECTED",
    });
  }, 30_000);

  it("stores only ciphertext and keeps managed credentials tenant-scoped", async () => {
    const key = randomBytes(32).toString("base64");
    const apiSecret = `secret-${randomUUID()}`;
    const reference = await storeEncryptedEmployeeDirectorySecret({
      organizationId: organizationA,
      secret: { method: "token", apiKey: "api-key", apiSecret },
      key,
    });
    const stored =
      await prisma.employeeDirectoryCredentialSecret.findFirstOrThrow({
        where: { organizationId: organizationA },
      });

    expect(reference).toBe(`managed:${stored.id}`);
    expect(stored.encryptedPayload).not.toContain("api-key");
    expect(stored.encryptedPayload).not.toContain(apiSecret);

    const provider = new PrismaEncryptedEmployeeDirectorySecretProvider(key);
    await expect(
      provider.getSecret({
        organizationId: organizationA,
        reference,
        authMethod: "token",
      }),
    ).resolves.toEqual({ method: "token", apiKey: "api-key", apiSecret });
    await expect(
      provider.getSecret({
        organizationId: organizationB,
        reference,
        authMethod: "token",
      }),
    ).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
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
