import { prisma } from "@/infrastructure/database/prisma";
import type { EmployerOnboardingRepository } from "@/modules/organizations/application/ports/employer-onboarding-repository";

function lower<T extends string>(value: string): T {
  return value.toLowerCase() as T;
}

async function hasAdminAccess(
  organizationId: string,
  actorUserId: string,
): Promise<boolean> {
  return Boolean(
    await prisma.organizationMembership.findFirst({
      where: {
        organizationId,
        userId: actorUserId,
        role: "EMPLOYER_ADMIN",
        isActive: true,
      },
      select: { id: true },
    }),
  );
}

export const prismaEmployerOnboardingRepository: EmployerOnboardingRepository =
  {
    async getSnapshot(input) {
      if (!(await hasAdminAccess(input.organizationId, input.actorUserId))) {
        return null;
      }
      const organization = await prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          erpNextEnabled: true,
          memberships: {
            select: {
              role: true,
              isActive: true,
              userId: true,
              user: { select: { name: true, email: true } },
            },
          },
          lendingPolicy: true,
          employeeDirectoryIntegration: {
            select: {
              connectionStatus: true,
              lastSuccessfulSyncAt: true,
              syncRuns: {
                orderBy: { startedAt: "desc" },
                take: 1,
                select: {
                  status: true,
                  processedCount: true,
                  createdCount: true,
                  updatedCount: true,
                  deactivatedCount: true,
                  reactivatedCount: true,
                  reviewCount: true,
                  invitationCreatedCount: true,
                  invitationSentCount: true,
                  invitationFailureCount: true,
                  safeErrorSummary: true,
                  startedAt: true,
                },
              },
            },
          },
        },
      });
      if (!organization) return null;
      const integration = organization.employeeDirectoryIntegration;
      const latest = integration?.syncRuns[0];
      const administrator = organization.memberships.find(
        (membership) =>
          membership.userId === input.actorUserId &&
          membership.role === "EMPLOYER_ADMIN" &&
          membership.isActive,
      );
      if (!administrator) return null;
      return {
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          erpNextEnabled: organization.erpNextEnabled,
        },
        administrator: administrator.user,
        activeEmployerAdminCount: organization.memberships.filter(
          (membership) =>
            membership.role === "EMPLOYER_ADMIN" && membership.isActive,
        ).length,
        employeeCount: organization.memberships.filter(
          (membership) => membership.role === "EMPLOYEE",
        ).length,
        policy: organization.lendingPolicy,
        erpNext: integration
          ? {
              connectionStatus: lower(integration.connectionStatus),
              lastSuccessfulSyncAt: integration.lastSuccessfulSyncAt,
              latestSync: latest
                ? {
                    ...latest,
                    status: lower(latest.status),
                  }
                : null,
            }
          : null,
      };
    },

    async updateOrganizationName(input) {
      if (!(await hasAdminAccess(input.organizationId, input.actorUserId))) {
        return false;
      }
      const updated = await prisma.organization.updateMany({
        where: { id: input.organizationId },
        data: { name: input.name },
      });
      return updated.count === 1;
    },

    async setErpNextEnabled(input) {
      if (!(await hasAdminAccess(input.organizationId, input.actorUserId))) {
        return false;
      }
      const updated = await prisma.organization.updateMany({
        where: { id: input.organizationId },
        data: { erpNextEnabled: input.enabled },
      });
      return updated.count === 1;
    },
  };
