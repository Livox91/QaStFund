import { describe, expect, it, vi } from "vitest";

import { parsePublicTestnetEnvironment } from "@/infrastructure/config/environment-schema";
import {
  buildArcWalletChallengeMessage,
  completeArcWalletChallenge,
  hashArcWalletNonce,
  issueArcWalletChallenge,
} from "@/modules/arc-wallet/application/arc-wallet-enrollment";
import {
  ArcWalletChallengeError,
  ArcWalletOwnershipError,
} from "@/modules/arc-wallet/application/errors";
import type { ArcWalletRepository } from "@/modules/arc-wallet/application/ports/arc-wallet-repository";
import { completeArcWalletChallengeSchema } from "@/modules/arc-wallet/schemas/arc-wallet.schema";
import { ApplicationRole } from "@/modules/auth/domain/application-role";

const now = new Date("2026-09-29T12:00:00.000Z");
const address = "0x1111111111111111111111111111111111111111" as const;
const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.test",
  name: "Alice",
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationName: "Acme",
  organizationSlug: "acme",
  role: ApplicationRole.EMPLOYEE,
} as const;

function repository(overrides: Partial<ArcWalletRepository> = {}) {
  const base: ArcWalletRepository = {
    findForEmployee: vi.fn(async () => null),
    beginEnrollment: vi.fn(async (input) => ({
      wallet: {
        id: "33333333-3333-4333-8333-333333333333",
        organizationId: input.organizationId,
        userId: input.userId,
        address: null,
        network: "ARC_TESTNET" as const,
        chainId: 5_042_002 as const,
        walletType: "CIRCLE_MODULAR" as const,
        status: "PENDING" as const,
        enrollmentState: "REGISTERING" as const,
        createdAt: now,
        updatedAt: now,
      },
      action: "REGISTER" as const,
    })),
    markRegistrationComplete: vi.fn(async () => undefined),
    createChallenge: vi.fn(async (input) => ({
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: input.organizationId,
      userId: input.userId,
      address: input.address,
      nonceHash: input.nonceHash,
      expiresAt: input.expiresAt,
      consumedAt: null,
    })),
    findChallenge: vi.fn(async () => null),
    activateFromChallenge: vi.fn(async (input) => ({
      id: "33333333-3333-4333-8333-333333333333",
      organizationId: input.organizationId,
      userId: input.userId,
      address: input.address,
      network: "ARC_TESTNET" as const,
      chainId: 5_042_002 as const,
      walletType: "CIRCLE_MODULAR" as const,
      status: "ACTIVE" as const,
      enrollmentState: "ACTIVE" as const,
      createdAt: now,
      updatedAt: now,
    })),
  };
  return { ...base, ...overrides };
}

describe("Arc wallet enrollment", () => {
  it("binds a challenge to the authenticated employee and organization", async () => {
    const repo = repository();
    const result = await issueArcWalletChallenge(actor, address, {
      repository: repo,
      now: () => now,
      createNonce: () => "n".repeat(32),
    });

    expect(repo.createChallenge).toHaveBeenCalledWith({
      organizationId: actor.organizationId,
      userId: actor.userId,
      address,
      nonceHash: hashArcWalletNonce("n".repeat(32)),
      expiresAt: new Date("2026-09-29T12:05:00.000Z"),
    });
    expect(result.message).toContain(`Organization: ${actor.organizationId}`);
    expect(result.message).toContain(`User: ${actor.userId}`);
  });

  it("does not activate a client-supplied address without a valid signature", async () => {
    const nonce = "n".repeat(32);
    const challenge = {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: actor.organizationId,
      userId: actor.userId,
      address,
      nonceHash: hashArcWalletNonce(nonce),
      expiresAt: new Date("2026-09-29T12:05:00.000Z"),
      consumedAt: null,
    };
    const repo = repository({ findChallenge: vi.fn(async () => challenge) });

    await expect(
      completeArcWalletChallenge(
        actor,
        {
          challengeId: challenge.id,
          address,
          nonce,
          signature: "0x1234",
        },
        {
          repository: repo,
          verifySignature: vi.fn(async () => false),
          now: () => now,
        },
      ),
    ).rejects.toBeInstanceOf(ArcWalletOwnershipError);
    expect(repo.activateFromChallenge).not.toHaveBeenCalled();
  });

  it("prevents a different organization from consuming the challenge", async () => {
    const repo = repository();
    await expect(
      completeArcWalletChallenge(
        { ...actor, organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        {
          challengeId: "22222222-2222-4222-8222-222222222222",
          address,
          nonce: "n".repeat(32),
          signature: "0x1234",
        },
        {
          repository: repo,
          verifySignature: vi.fn(async () => true),
          now: () => now,
        },
      ),
    ).rejects.toBeInstanceOf(ArcWalletChallengeError);
    expect(repo.findChallenge).toHaveBeenCalledWith({
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      userId: actor.userId,
    });
  });

  it("activates only after ownership verification", async () => {
    const nonce = "n".repeat(32);
    const challenge = {
      id: "22222222-2222-4222-8222-222222222222",
      organizationId: actor.organizationId,
      userId: actor.userId,
      address,
      nonceHash: hashArcWalletNonce(nonce),
      expiresAt: new Date("2026-09-29T12:05:00.000Z"),
      consumedAt: null,
    };
    const repo = repository({ findChallenge: vi.fn(async () => challenge) });
    const verifySignature = vi.fn(async (input) => {
      expect(input.message).toBe(
        buildArcWalletChallengeMessage({
          organizationId: actor.organizationId,
          userId: actor.userId,
          address,
          nonce,
          expiresAt: challenge.expiresAt,
        }),
      );
      return true;
    });

    const wallet = await completeArcWalletChallenge(
      actor,
      {
        challengeId: challenge.id,
        address,
        nonce,
        signature: "0x1234",
      },
      { repository: repo, verifySignature, now: () => now },
    );
    expect(wallet).toMatchObject({
      organizationId: actor.organizationId,
      userId: actor.userId,
      address,
      status: "ACTIVE",
    });
  });

  it("rejects missing Circle configuration cleanly", () => {
    expect(() =>
      parsePublicTestnetEnvironment({
        NEXT_PUBLIC_CIRCLE_CLIENT_KEY: "",
        NEXT_PUBLIC_CIRCLE_CLIENT_URL:
          "https://modular-sdk.circle.com/v1/rpc/w3s/buidl",
        NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS:
          "0x1111111111111111111111111111111111111111",
      }),
    ).toThrow("NEXT_PUBLIC_CIRCLE_CLIENT_KEY is required");
  });

  it("drops secret and raw credential fields from completion input", () => {
    const parsed = completeArcWalletChallengeSchema.parse({
      challengeId: "22222222-2222-4222-8222-222222222222",
      address,
      nonce: "n".repeat(32),
      signature: "0x1234",
      privateKey: "must-not-persist",
      seedPhrase: "must-not-persist",
      credential: { raw: "must-not-persist" },
    });
    expect(parsed).toEqual({
      challengeId: "22222222-2222-4222-8222-222222222222",
      address,
      nonce: "n".repeat(32),
      signature: "0x1234",
    });
  });
});
