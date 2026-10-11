import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArcWalletNetwork, MembershipRole } from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { ArcWalletConflictError } from "@/modules/arc-wallet/application/errors";
import { prismaArcWalletRepository } from "@/modules/arc-wallet/infrastructure/prisma-arc-wallet-repository";

const organizationId = randomUUID();
const nextOrganizationId = randomUUID();
const firstUserId = randomUUID();
const secondUserId = randomUUID();
const returningUserId = randomUUID();
const address = "0x2222222222222222222222222222222222222222" as const;
const now = new Date("2026-09-29T12:00:00.000Z");

async function createEmployee(userId: string, email: string) {
  await prisma.user.create({
    data: { id: userId, email, name: email, passwordHash: "test-only" },
  });
  await prisma.organizationMembership.create({
    data: {
      organizationId,
      userId,
      role: MembershipRole.EMPLOYEE,
    },
  });
}

describe("Arc wallet database constraints", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Arc wallet test organization",
        slug: `arc-wallet-${organizationId}`,
      },
    });
    await prisma.organization.create({
      data: {
        id: nextOrganizationId,
        name: "Next Arc wallet test organization",
        slug: `arc-wallet-${nextOrganizationId}`,
      },
    });
    await createEmployee(firstUserId, `${firstUserId}@example.test`);
    await createEmployee(secondUserId, `${secondUserId}@example.test`);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, nextOrganizationId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [firstUserId, secondUserId, returningUserId] } },
    });
    await prisma.$disconnect();
  });

  it("associates the wallet with the employee", async () => {
    const challenge = await prismaArcWalletRepository.createChallenge({
      organizationId,
      userId: firstUserId,
      address,
      nonceHash: "a".repeat(64),
      expiresAt: new Date("2026-09-29T12:05:00.000Z"),
    });
    const wallet = await prismaArcWalletRepository.activateFromChallenge({
      challengeId: challenge.id,
      organizationId,
      userId: firstUserId,
      address,
      now,
    });
    expect(wallet).toMatchObject({
      userId: firstUserId,
      address,
      network: "ARC_TESTNET",
      chainId: 5_042_002,
      walletType: "CIRCLE_MODULAR",
      status: "ACTIVE",
    });
  });

  it("does not duplicate an existing ACTIVE employee wallet", async () => {
    await prismaArcWalletRepository.createChallenge({
      organizationId,
      userId: firstUserId,
      address,
      nonceHash: "b".repeat(64),
      expiresAt: new Date("2026-09-29T12:10:00.000Z"),
    });
    await expect(
      prisma.arcWallet.findMany({
        where: { userId: firstUserId, network: ArcWalletNetwork.ARC_TESTNET },
        select: { status: true, enrollmentState: true },
      }),
    ).resolves.toEqual([{ status: "ACTIVE", enrollmentState: "ACTIVE" }]);
  });

  it("prevents one address from being associated with two employees", async () => {
    await prismaArcWalletRepository.beginEnrollment({
      organizationId,
      userId: secondUserId,
      intent: "RECOVER",
    });
    await prismaArcWalletRepository.beginEnrollment({
      organizationId,
      userId: secondUserId,
      intent: "RECOVER",
    });
    expect(
      await prisma.arcWallet.count({
        where: { userId: secondUserId, network: ArcWalletNetwork.ARC_TESTNET },
      }),
    ).toBe(1);
    const challenge = await prismaArcWalletRepository.createChallenge({
      organizationId,
      userId: secondUserId,
      address,
      nonceHash: "c".repeat(64),
      expiresAt: new Date("2026-09-29T12:05:00.000Z"),
    });
    await expect(
      prismaArcWalletRepository.activateFromChallenge({
        challengeId: challenge.id,
        organizationId,
        userId: secondUserId,
        address,
        now,
      }),
    ).rejects.toBeInstanceOf(ArcWalletConflictError);
  });

  it("persists no key, seed, or passkey credential material", async () => {
    const wallet = await prisma.arcWallet.findUniqueOrThrow({
      where: {
        userId_network: {
          userId: firstUserId,
          network: ArcWalletNetwork.ARC_TESTNET,
        },
      },
    });
    expect(Object.keys(wallet)).not.toEqual(
      expect.arrayContaining([
        "privateKey",
        "seedPhrase",
        "credential",
        "passkeyCredential",
      ]),
    );
  });

  it("reconnects the same user-owned wallet after an organization change", async () => {
    await prisma.organizationMembership.update({
      where: {
        organizationId_userId: { organizationId, userId: firstUserId },
      },
      data: { isActive: false, employmentStatus: "TERMINATED" },
    });
    await prisma.organizationMembership.create({
      data: {
        organizationId: nextOrganizationId,
        userId: firstUserId,
        role: MembershipRole.EMPLOYEE,
      },
    });

    const enrollment = await prismaArcWalletRepository.beginEnrollment({
      organizationId: nextOrganizationId,
      userId: firstUserId,
      intent: "RECOVER",
    });
    expect(enrollment.action).toBe("LOGIN");
    expect(enrollment.wallet.address).toBe(address);

    const challenge = await prismaArcWalletRepository.createChallenge({
      organizationId: nextOrganizationId,
      userId: firstUserId,
      address,
      nonceHash: "d".repeat(64),
      expiresAt: new Date("2026-09-29T12:15:00.000Z"),
    });
    const reconnected = await prismaArcWalletRepository.activateFromChallenge({
      challengeId: challenge.id,
      organizationId: nextOrganizationId,
      userId: firstUserId,
      address,
      now,
    });

    expect(reconnected.id).toBe(enrollment.wallet.id);
    expect(reconnected.address).toBe(address);
    await expect(
      prisma.arcWallet.count({
        where: { userId: firstUserId, network: ArcWalletNetwork.ARC_TESTNET },
      }),
    ).resolves.toBe(1);
  });

  it("relinks a signed wallet when the returning employee has a new account email", async () => {
    await prisma.organizationMembership.update({
      where: {
        organizationId_userId: {
          organizationId: nextOrganizationId,
          userId: firstUserId,
        },
      },
      data: { isActive: false, employmentStatus: "TERMINATED" },
    });
    await prisma.user.create({
      data: {
        id: returningUserId,
        email: `${returningUserId}@example.test`,
        name: "Returning employee",
        passwordHash: "test-only",
      },
    });
    await prisma.organizationMembership.create({
      data: {
        organizationId: nextOrganizationId,
        userId: returningUserId,
        role: MembershipRole.EMPLOYEE,
      },
    });
    await prismaArcWalletRepository.beginEnrollment({
      organizationId: nextOrganizationId,
      userId: returningUserId,
      intent: "RECOVER",
    });
    const challenge = await prismaArcWalletRepository.createChallenge({
      organizationId: nextOrganizationId,
      userId: returningUserId,
      address,
      nonceHash: "e".repeat(64),
      expiresAt: new Date("2026-09-29T12:20:00.000Z"),
    });
    const reconnected = await prismaArcWalletRepository.activateFromChallenge({
      challengeId: challenge.id,
      organizationId: nextOrganizationId,
      userId: returningUserId,
      address,
      now,
    });

    expect(reconnected).toMatchObject({
      userId: returningUserId,
      address,
      status: "ACTIVE",
    });
    await expect(
      prisma.arcWallet.findUnique({
        where: {
          userId_network: {
            userId: firstUserId,
            network: ArcWalletNetwork.ARC_TESTNET,
          },
        },
      }),
    ).resolves.toBeNull();
  });

  it("preserves a personal wallet when the former organization is deleted", async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    await expect(
      prisma.arcWallet.findUnique({
        where: {
          userId_network: {
            userId: returningUserId,
            network: ArcWalletNetwork.ARC_TESTNET,
          },
        },
        select: { address: true, status: true },
      }),
    ).resolves.toEqual({ address, status: "ACTIVE" });
  });
});
