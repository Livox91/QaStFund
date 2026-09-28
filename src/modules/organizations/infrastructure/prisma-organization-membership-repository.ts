import { prisma } from "@/infrastructure/database/prisma";
import type { ApplicationRole } from "@/modules/auth/domain/application-role";
import type { OrganizationMembershipRepository } from "@/modules/organizations/application/ports/organization-membership-repository";

export const prismaOrganizationMembershipRepository: OrganizationMembershipRepository =
  {
    findOrganizationById(organizationId) {
      return prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, slug: true, currency: true },
      });
    },

    async listMembers(organizationId) {
      const memberships = await prisma.organizationMembership.findMany({
        where: { organizationId },
        orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
        select: {
          id: true,
          userId: true,
          role: true,
          isActive: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      });

      return memberships.map((membership) => ({
        id: membership.id,
        userId: membership.userId,
        name: membership.user.name,
        email: membership.user.email,
        role: membership.role as ApplicationRole,
        isActive: membership.isActive,
        joinedAt: membership.createdAt,
      }));
    },
  };
