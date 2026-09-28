import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import type { RegistrationRepository } from "@/modules/auth/application/ports/auth-repository";
import { ApplicationRole } from "@/modules/auth/domain/application-role";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export const prismaRegistrationRepository: RegistrationRepository = {
  async registerOrganizationAdmin(input) {
    try {
      const actor = await prisma.$transaction(async (transaction) => {
        const organization = await transaction.organization.create({
          data: {
            name: input.organizationName,
            slug: input.organizationSlug,
          },
          select: { id: true, name: true, slug: true },
        });
        const user = await transaction.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash: input.passwordHash,
          },
          select: { id: true, email: true, name: true },
        });

        await transaction.organizationMembership.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            role: MembershipRole.EMPLOYER_ADMIN,
          },
        });
        await transaction.session.create({
          data: {
            tokenHash: input.sessionTokenHash,
            userId: user.id,
            organizationId: organization.id,
            expiresAt: input.sessionExpiresAt,
          },
        });

        return {
          userId: user.id,
          email: user.email,
          name: user.name,
          organizationId: organization.id,
          organizationName: organization.name,
          organizationSlug: organization.slug,
          role: ApplicationRole.EMPLOYER_ADMIN,
        } as const;
      });

      return { kind: "CREATED", actor } as const;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { kind: "CONFLICT" } as const;
      }

      throw error;
    }
  },
};
