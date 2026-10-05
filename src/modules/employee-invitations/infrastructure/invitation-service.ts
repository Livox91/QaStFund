import "server-only";

import { prisma } from "@/infrastructure/database/prisma";
import {
  operationalFailureAlertThreshold,
  recordOperationalFailure,
  recordOperationalSuccess,
} from "@/infrastructure/observability/operational-signals";
import {
  InvalidOrExpiredTokenError,
  PasswordChangeRejectedError,
} from "@/modules/auth/application/errors/auth-errors";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import { SESSION_DURATION_MS } from "@/modules/auth/domain/session";
import {
  generateSecureToken,
  hashSecureToken,
} from "@/modules/auth/domain/secure-token";
import { scryptPasswordHasher } from "@/modules/auth/infrastructure/scrypt-password-hasher";
import { secureSessionTokenService } from "@/modules/auth/infrastructure/secure-session-token-service";
import { invitationEmail } from "@/modules/employee-invitations/domain/invitation-email";
import { passwordResetEmail } from "@/modules/employee-invitations/domain/password-reset-email";
import type { EmailSender } from "@/modules/notifications/domain/email";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60_000;
const RESET_LIFETIME_MS = 60 * 60_000;

export async function inspectInvitation(token: string, now = new Date()) {
  if (!token) throw new InvalidOrExpiredTokenError();
  const invitation = await prisma.employeeInvitation.findUnique({
    where: { tokenHash: hashSecureToken(token) },
    include: {
      organization: { select: { name: true } },
      employeeMembership: {
        include: {
          user: { select: { name: true } },
          employeeDirectoryMappings: {
            select: { externalEmployeeId: true },
            take: 1,
          },
        },
      },
    },
  });
  if (
    !invitation ||
    invitation.status !== "PENDING" ||
    invitation.expiresAt <= now ||
    invitation.employeeMembership.employmentStatus !== "ACTIVE" ||
    invitation.employeeMembership.organizationId !==
      invitation.organizationId ||
    !invitation.employeeMembership.employeeDirectoryMappings[0]
  ) {
    if (invitation?.status === "PENDING" && invitation.expiresAt <= now) {
      await prisma.employeeInvitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
    }
    throw new InvalidOrExpiredTokenError();
  }
  return {
    organizationName: invitation.organization.name,
    employeeName: invitation.employeeMembership.user.name,
    email: invitation.email,
    expiresAt: invitation.expiresAt,
  };
}

export async function acceptInvitation(input: {
  token: string;
  email: string;
  password: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const passwordHash = await scryptPasswordHasher.hash(input.password);
  const sessionToken = secureSessionTokenService.generate();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  return prisma.$transaction(async (transaction) => {
    const invitation = await transaction.employeeInvitation.findUnique({
      where: { tokenHash: hashSecureToken(input.token) },
      include: {
        employeeMembership: {
          include: {
            employeeDirectoryMappings: {
              select: { externalEmployeeId: true },
              take: 1,
            },
          },
        },
      },
    });
    const email = input.email.trim().toLowerCase();
    if (
      !invitation ||
      invitation.status !== "PENDING" ||
      invitation.expiresAt <= now ||
      invitation.email !== email ||
      invitation.employeeMembership.organizationId !==
        invitation.organizationId ||
      invitation.employeeMembership.employmentStatus !== "ACTIVE" ||
      invitation.employeeMembership.accountActivatedAt !== null ||
      !invitation.employeeMembership.employeeDirectoryMappings[0]
    )
      throw new InvalidOrExpiredTokenError();
    const claimed = await transaction.employeeInvitation.updateMany({
      where: {
        id: invitation.id,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      data: { status: "ACCEPTED", acceptedAt: now },
    });
    if (claimed.count !== 1) throw new InvalidOrExpiredTokenError();
    await transaction.user.update({
      where: { id: invitation.employeeMembership.userId },
      data: { email, passwordHash },
    });
    await transaction.organizationMembership.update({
      where: { id: invitation.employeeMembershipId },
      data: { isActive: true, accountActivatedAt: now, removedAt: null },
    });
    await transaction.employeeInvitation.updateMany({
      where: {
        employeeMembershipId: invitation.employeeMembershipId,
        status: "PENDING",
        id: { not: invitation.id },
      },
      data: { status: "REVOKED", revokedAt: now },
    });
    await transaction.session.deleteMany({
      where: {
        organizationId: invitation.organizationId,
        userId: invitation.employeeMembership.userId,
      },
    });
    await transaction.session.create({
      data: {
        organizationId: invitation.organizationId,
        userId: invitation.employeeMembership.userId,
        tokenHash: secureSessionTokenService.hash(sessionToken),
        expiresAt,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: invitation.organizationId,
        targetMembershipId: invitation.employeeMembershipId,
        type: "EMPLOYEE_INVITATION_ACCEPTED",
        title: "Employee invitation accepted",
        occurredAt: now,
      },
    });
    return { sessionToken, expiresAt };
  });
}

export async function resendInvitation(input: {
  actor: AuthenticatedActor;
  membershipId: string;
  sender: EmailSender;
  appUrl: string;
  now?: Date;
}) {
  requireEmployerAdmin(input.actor);
  const now = input.now ?? new Date();
  const secureToken = generateSecureToken();
  const delivery = await prisma.$transaction(async (transaction) => {
    const membership = await transaction.organizationMembership.findFirst({
      where: {
        id: input.membershipId,
        organizationId: input.actor.organizationId,
        role: "EMPLOYEE",
        employmentStatus: "ACTIVE",
        accountActivatedAt: null,
      },
      include: {
        user: { select: { email: true } },
        organization: { select: { name: true } },
      },
    });
    if (!membership) throw new InvalidOrExpiredTokenError();
    const inviter = await transaction.organizationMembership.findUniqueOrThrow({
      where: {
        organizationId_userId: {
          organizationId: input.actor.organizationId,
          userId: input.actor.userId,
        },
      },
      select: { id: true },
    });
    const pending = await transaction.employeeInvitation.findFirst({
      where: {
        organizationId: input.actor.organizationId,
        employeeMembershipId: membership.id,
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
    });
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const invitation = pending
      ? await transaction.employeeInvitation.update({
          where: { id: pending.id },
          data: {
            email: membership.user.email,
            tokenHash: secureToken.tokenHash,
            expiresAt,
            sentAt: null,
            deliveryStatus: "CREATED",
            deliveryFailureCode: null,
            invitedByMembershipId: inviter.id,
          },
        })
      : await transaction.employeeInvitation.create({
          data: {
            organizationId: input.actor.organizationId,
            employeeMembershipId: membership.id,
            email: membership.user.email,
            tokenHash: secureToken.tokenHash,
            expiresAt,
            invitedByMembershipId: inviter.id,
          },
        });
    return { invitation, organizationName: membership.organization.name };
  });
  try {
    await input.sender.send({
      ...invitationEmail({
        appUrl: input.appUrl,
        token: secureToken.token,
        organizationName: delivery.organizationName,
        email: delivery.invitation.email,
        expiresAt: delivery.invitation.expiresAt,
      }),
      idempotencyKey: `employee-invitation:${delivery.invitation.id}:${delivery.invitation.expiresAt.getTime()}`,
    });
  } catch (error) {
    await prisma.employeeInvitation.update({
      where: { id: delivery.invitation.id },
      data: {
        deliveryStatus: "FAILED",
        deliveryFailureCode: emailFailureCode(error),
      },
    });
    recordEmailFailure(input.actor.organizationId, "invitation");
    throw error;
  }
  await prisma.$transaction([
    prisma.employeeInvitation.update({
      where: { id: delivery.invitation.id },
      data: {
        sentAt: now,
        deliveryStatus: "SENT",
        deliveryFailureCode: null,
      },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: input.actor.organizationId,
        targetMembershipId: input.membershipId,
        type: "EMPLOYEE_INVITATION_SENT",
        title: "Employee invitation sent",
        occurredAt: now,
      },
    }),
  ]);
  recordOperationalSuccess("email", now);
}

export async function revokeInvitation(input: {
  actor: AuthenticatedActor;
  membershipId: string;
  now?: Date;
}) {
  requireEmployerAdmin(input.actor);
  const now = input.now ?? new Date();
  await prisma.$transaction(async (transaction) => {
    const membership = await transaction.organizationMembership.findFirst({
      where: {
        id: input.membershipId,
        organizationId: input.actor.organizationId,
        role: "EMPLOYEE",
      },
      select: { id: true },
    });
    if (!membership) throw new InvalidOrExpiredTokenError();
    await transaction.employeeInvitation.updateMany({
      where: {
        organizationId: input.actor.organizationId,
        employeeMembershipId: membership.id,
        status: "PENDING",
      },
      data: { status: "REVOKED", revokedAt: now },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.actor.organizationId,
        targetMembershipId: membership.id,
        type: "EMPLOYEE_INVITATION_REVOKED",
        title: "Employee invitation revoked",
        occurredAt: now,
      },
    });
  });
}

export async function changePassword(input: {
  actor: AuthenticatedActor;
  currentPassword: string;
  newPassword: string;
  currentSessionToken?: string;
  now?: Date;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.actor.userId },
    select: { passwordHash: true },
  });
  if (
    !user ||
    !(await scryptPasswordHasher.verify(
      input.currentPassword,
      user.passwordHash,
    ))
  )
    throw new PasswordChangeRejectedError();
  const passwordHash = await scryptPasswordHasher.hash(input.newPassword);
  const currentHash = input.currentSessionToken
    ? secureSessionTokenService.hash(input.currentSessionToken)
    : null;
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: input.actor.userId },
      data: { passwordHash },
    });
    await transaction.session.deleteMany({
      where: {
        userId: input.actor.userId,
        ...(currentHash ? { tokenHash: { not: currentHash } } : {}),
      },
    });
    const membership =
      await transaction.organizationMembership.findUniqueOrThrow({
        where: {
          organizationId_userId: {
            organizationId: input.actor.organizationId,
            userId: input.actor.userId,
          },
        },
        select: { id: true },
      });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.actor.organizationId,
        actorMembershipId: membership.id,
        type: "PASSWORD_CHANGED",
        title: "Password changed",
        occurredAt: input.now ?? new Date(),
      },
    });
  });
}

export async function requestPasswordReset(input: {
  email: string;
  sender: EmailSender;
  appUrl: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: {
          isActive: true,
          OR: [
            { role: "EMPLOYER_ADMIN" },
            {
              role: "EMPLOYEE",
              employmentStatus: "ACTIVE",
              accountActivatedAt: { not: null },
            },
          ],
        },
        include: { organization: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  const membership = user?.memberships[0];
  if (!user || !membership) return;
  const secureToken = generateSecureToken();
  const reset = await prisma.$transaction(async (transaction) => {
    await transaction.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return transaction.passwordResetToken.create({
      data: {
        organizationId: membership.organizationId,
        membershipId: membership.id,
        userId: user.id,
        email,
        tokenHash: secureToken.tokenHash,
        expiresAt: new Date(now.getTime() + RESET_LIFETIME_MS),
      },
    });
  });
  try {
    await input.sender.send({
      ...passwordResetEmail({
        appUrl: input.appUrl,
        token: secureToken.token,
        organizationName: membership.organization.name,
        email,
      }),
      idempotencyKey: `password-reset:${reset.id}`,
    });
  } catch (error) {
    await prisma.passwordResetToken.update({
      where: { id: reset.id },
      data: {
        deliveryStatus: "FAILED",
        deliveryFailureCode: emailFailureCode(error),
      },
    });
    recordEmailFailure(membership.organizationId, "password_reset");
    throw error;
  }
  await prisma.passwordResetToken.update({
    where: { id: reset.id },
    data: {
      sentAt: now,
      deliveryStatus: "SENT",
      deliveryFailureCode: null,
    },
  });
  recordOperationalSuccess("email", now);
}

function emailFailureCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)
    ? error.message
    : "EMAIL_DELIVERY_FAILED";
}

function recordEmailFailure(
  organizationId: string,
  operation: "invitation" | "password_reset",
) {
  recordOperationalFailure("email", {
    alertThreshold: operationalFailureAlertThreshold(),
    context: { organizationId, operation },
  });
}

export async function resetPassword(input: {
  token: string;
  password: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const passwordHash = await scryptPasswordHasher.hash(input.password);
  await prisma.$transaction(async (transaction) => {
    const reset = await transaction.passwordResetToken.findUnique({
      where: { tokenHash: hashSecureToken(input.token) },
      include: { membership: true },
    });
    if (
      !reset ||
      reset.usedAt ||
      reset.revokedAt ||
      reset.expiresAt <= now ||
      !reset.membership.isActive ||
      reset.membership.employmentStatus !== "ACTIVE" ||
      reset.membership.organizationId !== reset.organizationId ||
      reset.membership.userId !== reset.userId
    )
      throw new InvalidOrExpiredTokenError();
    const claimed = await transaction.passwordResetToken.updateMany({
      where: {
        id: reset.id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw new InvalidOrExpiredTokenError();
    await transaction.user.update({
      where: { id: reset.userId },
      data: { passwordHash },
    });
    await transaction.passwordResetToken.updateMany({
      where: {
        userId: reset.userId,
        id: { not: reset.id },
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    await transaction.session.deleteMany({ where: { userId: reset.userId } });
    await transaction.auditEvent.create({
      data: {
        organizationId: reset.organizationId,
        targetMembershipId: reset.membershipId,
        type: "PASSWORD_RESET",
        title: "Password reset completed",
        occurredAt: now,
      },
    });
  });
}
