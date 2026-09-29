import { createHash, randomBytes } from "node:crypto";

import { getAddress, type Hex } from "viem";

import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  ArcWalletChallengeError,
  ArcWalletOwnershipError,
} from "@/modules/arc-wallet/application/errors";
import type { ArcWalletRepository } from "@/modules/arc-wallet/application/ports/arc-wallet-repository";

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;

export function hashArcWalletNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export function buildArcWalletChallengeMessage(input: {
  organizationId: string;
  userId: string;
  address: `0x${string}`;
  nonce: string;
  expiresAt: Date;
}): string {
  return [
    "Employee Lending Arc Wallet Verification",
    `Organization: ${input.organizationId}`,
    `User: ${input.userId}`,
    `Address: ${input.address}`,
    "Network: Arc Testnet",
    "Chain ID: 5042002",
    `Nonce: ${input.nonce}`,
    `Expires: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}

export async function issueArcWalletChallenge(
  actor: AuthenticatedActor | null,
  addressInput: string,
  dependencies: {
    repository: ArcWalletRepository;
    now?: () => Date;
    createNonce?: () => string;
  },
) {
  const employee = requireEmployee(actor);
  const address = getAddress(addressInput);
  const now = dependencies.now?.() ?? new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const nonce =
    dependencies.createNonce?.() ?? randomBytes(32).toString("base64url");
  const challenge = await dependencies.repository.createChallenge({
    organizationId: employee.organizationId,
    userId: employee.userId,
    address,
    nonceHash: hashArcWalletNonce(nonce),
    expiresAt,
  });
  return {
    challengeId: challenge.id,
    address,
    nonce,
    expiresAt,
    message: buildArcWalletChallengeMessage({
      organizationId: employee.organizationId,
      userId: employee.userId,
      address,
      nonce,
      expiresAt,
    }),
  };
}

export async function completeArcWalletChallenge(
  actor: AuthenticatedActor | null,
  input: {
    challengeId: string;
    address: string;
    nonce: string;
    signature: string;
  },
  dependencies: {
    repository: ArcWalletRepository;
    verifySignature: (input: {
      address: `0x${string}`;
      message: string;
      signature: Hex;
    }) => Promise<boolean>;
    now?: () => Date;
  },
) {
  const employee = requireEmployee(actor);
  const address = getAddress(input.address);
  const now = dependencies.now?.() ?? new Date();
  const challenge = await dependencies.repository.findChallenge({
    id: input.challengeId,
    organizationId: employee.organizationId,
    userId: employee.userId,
  });
  if (
    !challenge ||
    challenge.consumedAt ||
    challenge.expiresAt <= now ||
    challenge.address.toLowerCase() !== address.toLowerCase() ||
    challenge.nonceHash !== hashArcWalletNonce(input.nonce)
  ) {
    throw new ArcWalletChallengeError();
  }
  const message = buildArcWalletChallengeMessage({
    organizationId: employee.organizationId,
    userId: employee.userId,
    address,
    nonce: input.nonce,
    expiresAt: challenge.expiresAt,
  });
  if (
    !(await dependencies.verifySignature({
      address,
      message,
      signature: input.signature as Hex,
    }))
  ) {
    throw new ArcWalletOwnershipError();
  }
  return dependencies.repository.activateFromChallenge({
    challengeId: challenge.id,
    organizationId: employee.organizationId,
    userId: employee.userId,
    address,
    now,
  });
}
