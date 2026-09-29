import {
  ArcWalletNetwork,
  ArcWalletEnrollmentState,
  ArcWalletStatus,
  ArcWalletType,
  EmploymentStatus,
  MembershipRole,
  Prisma,
} from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  ARC_WALLET_TYPE,
} from "@/integrations/arc/arc-testnet";
import {
  ArcWalletChallengeError,
  ArcWalletConflictError,
} from "@/modules/arc-wallet/application/errors";
import type { ArcWalletRepository } from "@/modules/arc-wallet/application/ports/arc-wallet-repository";
import type {
  ArcWallet,
  ArcWalletChallenge,
} from "@/modules/arc-wallet/domain/arc-wallet";
import { ApplicationError } from "@/shared/errors/application-error";

function mapWallet(row: {
  id: string;
  organizationId: string;
  userId: string;
  address: string | null;
  status: ArcWalletStatus;
  enrollmentState: ArcWalletEnrollmentState;
  createdAt: Date;
  updatedAt: Date;
}): ArcWallet {
  return {
    ...row,
    address: row.address as `0x${string}` | null,
    network: ARC_TESTNET_NETWORK,
    chainId: ARC_TESTNET_CHAIN_ID,
    walletType: ARC_WALLET_TYPE,
  };
}

function mapChallenge(row: {
  id: string;
  organizationId: string;
  userId: string;
  address: string;
  nonceHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}): ArcWalletChallenge {
  return { ...row, address: row.address as `0x${string}` };
}

async function requireEmployeeMembership(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
) {
  const membership = await transaction.organizationMembership.findFirst({
    where: {
      organizationId,
      userId,
      isActive: true,
      employmentStatus: EmploymentStatus.ACTIVE,
      role: MembershipRole.EMPLOYEE,
    },
    select: { id: true },
  });
  if (!membership) {
    throw new ApplicationError(
      "ARC_WALLET_EMPLOYEE_NOT_FOUND",
      "The authenticated employee membership was not found.",
      404,
    );
  }
}

export const prismaArcWalletRepository: ArcWalletRepository = {
  async findForEmployee(input) {
    const row = await prisma.arcWallet.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        network: ArcWalletNetwork.ARC_TESTNET,
      },
    });
    return row ? mapWallet(row) : null;
  },

  async beginEnrollment(input) {
    return prisma.$transaction(async (transaction) => {
      await requireEmployeeMembership(
        transaction,
        input.organizationId,
        input.userId,
      );
      const existing = await transaction.arcWallet.findUnique({
        where: {
          userId_network: {
            userId: input.userId,
            network: ArcWalletNetwork.ARC_TESTNET,
          },
        },
      });
      if (existing && existing.organizationId !== input.organizationId) {
        throw new ArcWalletConflictError(
          "This employee already has an Arc wallet in another organization.",
        );
      }
      if (existing?.status === ArcWalletStatus.ACTIVE) {
        return { wallet: mapWallet(existing), action: "LOGIN" as const };
      }
      if (existing) {
        const wallet =
          input.intent === "RECOVER"
            ? await transaction.arcWallet.update({
                where: { id: existing.id },
                data: {
                  status: ArcWalletStatus.PENDING,
                  enrollmentState: ArcWalletEnrollmentState.FAILED_RECOVERABLE,
                },
              })
            : existing;
        return { wallet: mapWallet(wallet), action: "LOGIN" as const };
      }
      const wallet = await transaction.arcWallet.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          network: ArcWalletNetwork.ARC_TESTNET,
          chainId: ARC_TESTNET_CHAIN_ID,
          walletType: ArcWalletType.CIRCLE_MODULAR,
          status: ArcWalletStatus.PENDING,
          enrollmentState:
            input.intent === "RECOVER"
              ? ArcWalletEnrollmentState.FAILED_RECOVERABLE
              : ArcWalletEnrollmentState.REGISTERING,
        },
      });
      return {
        wallet: mapWallet(wallet),
        action:
          input.intent === "RECOVER"
            ? ("LOGIN" as const)
            : ("REGISTER" as const),
      };
    });
  },

  async markRegistrationComplete(input) {
    await prisma.arcWallet.updateMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        network: ArcWalletNetwork.ARC_TESTNET,
        status: { not: ArcWalletStatus.ACTIVE },
      },
      data: { enrollmentState: ArcWalletEnrollmentState.REGISTERED },
    });
  },

  async createChallenge(input) {
    return prisma.$transaction(async (transaction) => {
      await requireEmployeeMembership(
        transaction,
        input.organizationId,
        input.userId,
      );
      const existing = await transaction.arcWallet.findUnique({
        where: {
          userId_network: {
            userId: input.userId,
            network: ArcWalletNetwork.ARC_TESTNET,
          },
        },
      });
      if (existing && existing.organizationId !== input.organizationId) {
        throw new ArcWalletConflictError(
          "This employee already has an Arc wallet in another organization.",
        );
      }
      if (
        existing?.status === ArcWalletStatus.ACTIVE &&
        existing.address?.toLowerCase() !== input.address.toLowerCase()
      ) {
        throw new ArcWalletConflictError(
          "The passkey resolved to a different wallet than the enrolled wallet.",
        );
      }
      if (!existing) {
        await transaction.arcWallet.create({
          data: {
            organizationId: input.organizationId,
            userId: input.userId,
            network: ArcWalletNetwork.ARC_TESTNET,
            chainId: ARC_TESTNET_CHAIN_ID,
            walletType: ArcWalletType.CIRCLE_MODULAR,
            status: ArcWalletStatus.PENDING,
            enrollmentState: ArcWalletEnrollmentState.VERIFYING,
          },
        });
      } else {
        await transaction.arcWallet.update({
          where: { id: existing.id },
          data: {
            status: ArcWalletStatus.PENDING,
            enrollmentState: ArcWalletEnrollmentState.VERIFYING,
          },
        });
      }
      const challenge = await transaction.arcWalletChallenge.create({
        data: input,
      });
      return mapChallenge(challenge);
    });
  },

  async findChallenge(input) {
    const row = await prisma.arcWalletChallenge.findFirst({ where: input });
    return row ? mapChallenge(row) : null;
  },

  async activateFromChallenge(input) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const consumed = await transaction.arcWalletChallenge.updateMany({
          where: {
            id: input.challengeId,
            organizationId: input.organizationId,
            userId: input.userId,
            consumedAt: null,
            expiresAt: { gt: input.now },
          },
          data: { consumedAt: input.now },
        });
        if (consumed.count !== 1) throw new ArcWalletChallengeError();
        const wallet = await transaction.arcWallet.update({
          where: {
            userId_network: {
              userId: input.userId,
              network: ArcWalletNetwork.ARC_TESTNET,
            },
          },
          data: {
            address: input.address.toLowerCase(),
            organizationId: input.organizationId,
            chainId: ARC_TESTNET_CHAIN_ID,
            walletType: ArcWalletType.CIRCLE_MODULAR,
            status: ArcWalletStatus.ACTIVE,
            enrollmentState: ArcWalletEnrollmentState.ACTIVE,
          },
        });
        return mapWallet(wallet);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ArcWalletConflictError(
          "That Arc wallet is already associated with another employee.",
        );
      }
      throw error;
    }
  },
};
