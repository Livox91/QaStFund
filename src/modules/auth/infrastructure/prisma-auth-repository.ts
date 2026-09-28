import type {
  AuthRepository,
  AuthenticationUser,
} from "@/modules/auth/application/ports/auth-repository";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  ApplicationRole,
  type ApplicationRole as ApplicationRoleType,
} from "@/modules/auth/domain/application-role";
import { prisma } from "@/infrastructure/database/prisma";

function toApplicationRole(role: string): ApplicationRoleType {
  if (role === ApplicationRole.EMPLOYER_ADMIN) {
    return ApplicationRole.EMPLOYER_ADMIN;
  }

  return ApplicationRole.EMPLOYEE;
}

export const prismaAuthRepository: AuthRepository = {
  async findUserForAuthentication(
    email: string,
  ): Promise<AuthenticationUser | null> {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          include: { organization: true },
        },
      },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: user.passwordHash,
      memberships: user.memberships.map((membership) => ({
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        organizationSlug: membership.organization.slug,
        role: toApplicationRole(membership.role),
      })),
    };
  },

  async createSession(input): Promise<void> {
    await prisma.session.create({ data: input });
  },

  async findActorBySessionTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthenticatedActor | null> {
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: {
        membership: {
          include: {
            organization: true,
            user: true,
          },
        },
      },
    });

    if (!session || session.expiresAt <= now || !session.membership.isActive) {
      return null;
    }

    return {
      userId: session.membership.user.id,
      email: session.membership.user.email,
      name: session.membership.user.name,
      organizationId: session.membership.organization.id,
      organizationName: session.membership.organization.name,
      organizationSlug: session.membership.organization.slug,
      role: toApplicationRole(session.membership.role),
    };
  },

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await prisma.session.deleteMany({ where: { tokenHash } });
  },
};
