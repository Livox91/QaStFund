import { ArcWalletNetwork, MembershipRole } from "@/generated/prisma/client";
import { prisma } from "@/infrastructure/database/prisma";
import type { EmployeeIdentityRepository } from "@/modules/employees/application/ports/employee-identity-repository";

function latestDate(...dates: Date[]): Date {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

export const prismaEmployeeIdentityRepository: EmployeeIdentityRepository = {
  async findForEmployee({ organizationId, userId }) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        organizationId: true,
        role: true,
        employmentStatus: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
            updatedAt: true,
            arcWallets: {
              where: {
                organizationId,
                network: ArcWalletNetwork.ARC_TESTNET,
              },
              take: 1,
              select: { address: true, status: true, updatedAt: true },
            },
          },
        },
      },
    });

    if (!membership || membership.role !== MembershipRole.EMPLOYEE) {
      return null;
    }

    const wallet = membership.user.arcWallets[0];
    return {
      userId: membership.user.id,
      organizationId: membership.organizationId,
      name: membership.user.name,
      email: membership.user.email,
      walletAddress: wallet?.address ?? null,
      walletStatus: wallet?.status ?? null,
      employmentStatus: membership.employmentStatus,
      createdAt: membership.user.createdAt,
      updatedAt: latestDate(
        membership.user.updatedAt,
        membership.updatedAt,
        wallet?.updatedAt ?? membership.updatedAt,
      ),
    };
  },
};
