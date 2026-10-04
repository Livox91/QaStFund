import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/infrastructure/database/prisma";
import { revokeSession } from "@/modules/auth/application/revoke-session";
import type { SessionTokenService } from "@/modules/auth/application/ports/session-token-service";
import { prismaAuthRepository } from "@/modules/auth/infrastructure/prisma-auth-repository";
import { prismaRegistrationRepository } from "@/modules/auth/infrastructure/prisma-registration-repository";
import { prismaEmployerOnboardingRepository } from "@/modules/organizations/infrastructure/prisma-employer-onboarding-repository";

const suffix = randomUUID();
const emailA = `onboarding-a-${suffix}@example.test`;
const emailB = `onboarding-b-${suffix}@example.test`;
const slugA = `onboarding-a-${suffix}`;
const duplicateSlug = `onboarding-duplicate-${suffix}`;
const slugB = `onboarding-b-${suffix}`;
const organizationIds: string[] = [];
const userIds: string[] = [];

async function register(email: string, slug: string, token: string) {
  const result = await prismaRegistrationRepository.registerOrganizationAdmin({
    name: "Onboarding administrator",
    email,
    passwordHash: "test-only-password-hash",
    organizationName: `Organization ${slug}`,
    organizationSlug: slug,
    sessionTokenHash: token.repeat(64),
    sessionExpiresAt: new Date("2026-10-05T12:00:00.000Z"),
  });
  if (result.kind === "CREATED") {
    organizationIds.push(result.actor.organizationId);
    userIds.push(result.actor.userId);
  }
  return result;
}

describe("employer onboarding database isolation", () => {
  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("creates one organization per registration and rolls back a duplicate employer", async () => {
    const first = await register(emailA, slugA, "a");
    expect(first.kind).toBe("CREATED");

    await expect(register(emailA, duplicateSlug, "b")).resolves.toEqual({
      kind: "CONFLICT",
    });
    await expect(
      prisma.organization.count({
        where: { slug: { in: [slugA, duplicateSlug] } },
      }),
    ).resolves.toBe(1);
  });

  it("rejects profile and ERPNext changes across organizations", async () => {
    const firstUser = await prisma.user.findUniqueOrThrow({
      where: { email: emailA },
    });
    const second = await register(emailB, slugB, "c");
    if (second.kind !== "CREATED") throw new Error("TEST_SETUP_FAILED");

    await expect(
      prismaEmployerOnboardingRepository.updateOrganizationName({
        organizationId: second.actor.organizationId,
        actorUserId: firstUser.id,
        name: "Unauthorized rename",
      }),
    ).resolves.toBe(false);
    await expect(
      prismaEmployerOnboardingRepository.setErpNextEnabled({
        organizationId: second.actor.organizationId,
        actorUserId: firstUser.id,
        enabled: true,
      }),
    ).resolves.toBe(false);

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: second.actor.organizationId },
    });
    expect(organization.name).toBe(`Organization ${slugB}`);
    expect(organization.erpNextEnabled).toBe(false);
  });

  it("updates only the authenticated administrator's organization", async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: emailA },
    });
    const membership = await prisma.organizationMembership.findFirstOrThrow({
      where: { userId: user.id, role: "EMPLOYER_ADMIN" },
    });
    await expect(
      prismaEmployerOnboardingRepository.updateOrganizationName({
        organizationId: membership.organizationId,
        actorUserId: user.id,
        name: "Renamed pilot organization",
      }),
    ).resolves.toBe(true);
    await expect(
      prismaEmployerOnboardingRepository.setErpNextEnabled({
        organizationId: membership.organizationId,
        actorUserId: user.id,
        enabled: true,
      }),
    ).resolves.toBe(true);

    await expect(
      prismaEmployerOnboardingRepository.getSnapshot({
        organizationId: membership.organizationId,
        actorUserId: user.id,
      }),
    ).resolves.toMatchObject({
      organization: {
        name: "Renamed pilot organization",
        erpNextEnabled: true,
      },
      activeEmployerAdminCount: 1,
    });
  });

  it("rejects expired employer sessions and revokes logout sessions", async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: emailA },
    });
    const membership = await prisma.organizationMembership.findFirstOrThrow({
      where: { userId: user.id, role: "EMPLOYER_ADMIN" },
    });
    await expect(
      prismaAuthRepository.findActorBySessionTokenHash(
        "a".repeat(64),
        new Date("2026-10-05T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();

    const logoutHash = "d".repeat(64);
    await prismaAuthRepository.createSession({
      tokenHash: logoutHash,
      userId: user.id,
      organizationId: membership.organizationId,
      expiresAt: new Date("2026-10-06T12:00:00.000Z"),
    });
    await revokeSession("raw-logout-token", {
      authRepository: prismaAuthRepository,
      sessionTokenService: {
        generate: () => "unused",
        hash: () => logoutHash,
      } satisfies SessionTokenService,
    });
    await expect(
      prismaAuthRepository.findActorBySessionTokenHash(
        logoutHash,
        new Date("2026-10-04T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();
  });
});
