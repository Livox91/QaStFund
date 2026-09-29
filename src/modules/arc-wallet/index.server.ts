import "server-only";

import { requireEmployee } from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  completeArcWalletChallenge,
  issueArcWalletChallenge,
} from "@/modules/arc-wallet/application/arc-wallet-enrollment";
import {
  beginArcWalletEnrollment,
  markArcWalletRegistrationComplete,
} from "@/modules/arc-wallet/application/arc-wallet-identity";
import {
  getArcNativeUsdcBalance,
  verifyCircleArcWalletSignature,
} from "@/modules/arc-wallet/infrastructure/circle-arc-client";
import { prismaArcWalletRepository } from "@/modules/arc-wallet/infrastructure/prisma-arc-wallet-repository";

export async function getArcWalletForActor(actor: AuthenticatedActor | null) {
  const employee = requireEmployee(actor);
  return prismaArcWalletRepository.findForEmployee({
    organizationId: employee.organizationId,
    userId: employee.userId,
  });
}

export async function issueArcWalletChallengeForActor(
  actor: AuthenticatedActor | null,
  address: string,
) {
  return issueArcWalletChallenge(actor, address, {
    repository: prismaArcWalletRepository,
  });
}

export async function beginArcWalletEnrollmentForActor(
  actor: AuthenticatedActor | null,
  intent: "CREATE" | "RECOVER",
) {
  return beginArcWalletEnrollment(actor, intent, prismaArcWalletRepository);
}

export async function markArcWalletRegistrationCompleteForActor(
  actor: AuthenticatedActor | null,
) {
  await markArcWalletRegistrationComplete(actor, prismaArcWalletRepository);
}

export async function completeArcWalletChallengeForActor(
  actor: AuthenticatedActor | null,
  input: {
    challengeId: string;
    address: string;
    nonce: string;
    signature: string;
  },
) {
  return completeArcWalletChallenge(actor, input, {
    repository: prismaArcWalletRepository,
    verifySignature: verifyCircleArcWalletSignature,
  });
}

export { getArcNativeUsdcBalance };
