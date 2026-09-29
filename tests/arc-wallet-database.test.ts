import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArcWalletNetwork, MembershipRole } from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import { ArcWalletConflictError } from "@/modules/arc-wallet/application/errors";
import { prismaArcWalletRepository } from "@/modules/arc-wallet/infrastructure/prisma-arc-wallet-repository";

const organizationId = randomUUID();
const firstUserId = randomUUID();
const secondUserId = randomUUID();
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
    await createEmployee(firstUserId, `${firstUserId}@example.test`);
    await createEmployee(secondUserId, `${secondUserId}@example.test`);
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [firstUserId, secondUserId] } },
    });
    await prisma.$disconnect();
  });

  it("associates the wallet with the employee and organization", async () => {
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
      organizationId,
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
    expect(
      await prisma.arcWallet.count({
        where: { userId: firstUserId, network: ArcWalletNetwork.ARC_TESTNET },
      }),
    ).toBe(1);
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
});
