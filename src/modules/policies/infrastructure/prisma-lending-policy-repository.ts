import { MembershipRole } from "@/generated/prisma/enums";
import { prisma } from "@/infrastructure/database/prisma";
import {
  calculateBorrowingCapacity,
  policySnapshot,
  validatePolicyConfiguration,
  type LendingPolicyValues,
} from "@/modules/policies/domain/lending-policy";
import {
  calculateBorrowerObligations,
  ensureOrganizationPolicy,
} from "@/modules/policies/infrastructure/policy-data";

export async function getOrganizationPolicy(organizationId: string) {
  return prisma.$transaction((transaction) =>
    ensureOrganizationPolicy(transaction, organizationId),
  );
}

export async function updateOrganizationPolicy(input: {
  organizationId: string;
  actorUserId: string;
  values: LendingPolicyValues;
  now: Date;
}) {
  if (!validatePolicyConfiguration(input.values)) return null;
  return prisma.$transaction(async (transaction) => {
    const actor = await transaction.organizationMembership.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: input.actorUserId,
        role: MembershipRole.EMPLOYER_ADMIN,
        isActive: true,
      },
      select: { id: true, user: { select: { name: true } } },
    });
    if (!actor) return null;
    await transaction.$queryRaw`SELECT "id" FROM "OrganizationLendingPolicy" WHERE "organizationId" = CAST(${input.organizationId} AS UUID) FOR UPDATE`;
    const before = await ensureOrganizationPolicy(
      transaction,
      input.organizationId,
    );
    const after = await transaction.organizationLendingPolicy.update({
      where: { organizationId: input.organizationId },
      data: { ...input.values, policyVersion: { increment: 1 } },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorMembershipId: actor.id,
        type: "LENDING_POLICY_UPDATED",
        title: "Organization lending policy updated",
        actorLabel: actor.user.name,
        occurredAt: input.now,
        metadata: {
          before: policySnapshot(before),
          after: policySnapshot(after),
        },
      },
    });
    return after;
  });
}

export async function getEmployeeBorrowingCapacity(input: {
  organizationId: string;
  userId: string;
}) {
  return prisma.$transaction(async (transaction) => {
    const membership = await transaction.organizationMembership.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        role: MembershipRole.EMPLOYEE,
        isActive: true,
      },
      select: { id: true, canBorrow: true, employmentStatus: true },
    });
    if (!membership) return null;
    const policy = await ensureOrganizationPolicy(
      transaction,
      input.organizationId,
    );
    const obligations = await calculateBorrowerObligations(
      transaction,
      input.organizationId,
      membership.id,
    );
    return calculateBorrowingCapacity(
      policy,
      {
        canBorrow:
          membership.canBorrow && membership.employmentStatus === "ACTIVE",
      },
      obligations,
    );
  });
}

export async function listEmployeesWithLendingAccess(organizationId: string) {
  return prisma.$transaction(async (transaction) => {
    const employees = await transaction.organizationMembership.findMany({
      where: { organizationId, role: MembershipRole.EMPLOYEE },
      orderBy: { user: { name: "asc" } },
      select: {
        id: true,
        isActive: true,
        employmentStatus: true,
        employmentStatusSyncedAt: true,
        removedAt: true,
        accountActivatedAt: true,
        canBorrow: true,
        canLend: true,
        user: { select: { id: true, name: true, email: true } },
        employeeDirectoryMappings: {
          select: {
            externalEmployeeId: true,
            employeeCode: true,
            email: true,
            department: true,
            designation: true,
          },
          take: 1,
        },
        employeeInvitations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            createdAt: true,
            sentAt: true,
            expiresAt: true,
            acceptedAt: true,
            deliveryStatus: true,
            deliveryFailureCode: true,
          },
        },
      },
    });
    const results = [];
    for (const employee of employees) {
      results.push({
        id: employee.id,
        userId: employee.user.id,
        name: employee.user.name,
        email:
          employee.employeeDirectoryMappings[0]?.email ?? employee.user.email,
        isActive: employee.isActive,
        employmentStatus: employee.employmentStatus,
        employmentStatusSyncedAt: employee.employmentStatusSyncedAt,
        removedAt: employee.removedAt,
        accountActivatedAt: employee.accountActivatedAt,
        invitation: employee.employeeInvitations[0] ?? null,
        externalEmployeeId:
          employee.employeeDirectoryMappings[0]?.externalEmployeeId ?? null,
        employeeCode:
          employee.employeeDirectoryMappings[0]?.employeeCode ?? null,
        department: employee.employeeDirectoryMappings[0]?.department ?? null,
        designation: employee.employeeDirectoryMappings[0]?.designation ?? null,
        canBorrow: employee.canBorrow,
        canLend: employee.canLend,
        ...(await calculateBorrowerObligations(
          transaction,
          organizationId,
          employee.id,
        )),
      });
    }
    return results;
  });
}

export async function getEmployeeProfileForOrganization(input: {
  organizationId: string;
  employeeMembershipId: string;
}) {
  return prisma.organizationMembership.findFirst({
    where: {
      id: input.employeeMembershipId,
      organizationId: input.organizationId,
      role: MembershipRole.EMPLOYEE,
    },
    select: {
      id: true,
      isActive: true,
      employmentStatus: true,
      employmentStatusSyncedAt: true,
      removedAt: true,
      accountActivatedAt: true,
      canBorrow: true,
      canLend: true,
      user: { select: { name: true, email: true } },
      employeeDirectoryMappings: {
        select: {
          externalEmployeeId: true,
          employeeCode: true,
          email: true,
          department: true,
          designation: true,
          externalStatus: true,
          lastSynchronizedAt: true,
        },
        take: 1,
      },
      employeeInvitations: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          createdAt: true,
          sentAt: true,
          expiresAt: true,
          acceptedAt: true,
        },
      },
      loansAsBorrower: {
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          status: true,
          principalAmountMinorUnits: true,
          outstandingPrincipalMinorUnits: true,
          currency: true,
          startedAt: true,
          repaymentDueAt: true,
          repayments: {
            orderBy: { paidAt: "asc" },
            select: {
              id: true,
              status: true,
              amountMinorUnits: true,
              currency: true,
              paidAt: true,
            },
          },
        },
      },
      loansAsLender: {
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          status: true,
          principalAmountMinorUnits: true,
          outstandingPrincipalMinorUnits: true,
          currency: true,
          startedAt: true,
          repaymentDueAt: true,
        },
      },
      lendingOffers: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          amountMinorUnits: true,
          availableAmountMinorUnits: true,
          currency: true,
          createdAt: true,
          fundingTransactionHash: true,
        },
      },
      auditEventsTargeted: {
        orderBy: { occurredAt: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          title: true,
          occurredAt: true,
        },
      },
    },
  });
}

export async function updateEmployeeLendingAccess(input: {
  organizationId: string;
  actorUserId: string;
  employeeMembershipId: string;
  canBorrow: boolean;
  canLend: boolean;
  now: Date;
}) {
  return prisma.$transaction(async (transaction) => {
    const actor = await transaction.organizationMembership.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: input.actorUserId,
        role: MembershipRole.EMPLOYER_ADMIN,
        isActive: true,
      },
      select: { id: true, user: { select: { name: true } } },
    });
    if (!actor) return null;
    await transaction.$queryRaw`SELECT "id" FROM "OrganizationMembership" WHERE "id" = CAST(${input.employeeMembershipId} AS UUID) AND "organizationId" = CAST(${input.organizationId} AS UUID) FOR UPDATE`;
    const employee = await transaction.organizationMembership.findFirst({
      where: {
        id: input.employeeMembershipId,
        organizationId: input.organizationId,
        role: MembershipRole.EMPLOYEE,
      },
      select: { id: true, canBorrow: true, canLend: true },
    });
    if (!employee) return null;
    const employeeWithUser =
      await transaction.organizationMembership.findUniqueOrThrow({
        where: { id: employee.id },
        select: { userId: true },
      });
    const updated = await transaction.organizationMembership.update({
      where: { id: employee.id },
      data: { canBorrow: input.canBorrow, canLend: input.canLend },
      select: { id: true, canBorrow: true, canLend: true },
    });
    const events = [];
    if (employee.canBorrow !== input.canBorrow)
      events.push({
        organizationId: input.organizationId,
        actorMembershipId: actor.id,
        targetMembershipId: employee.id,
        type: input.canBorrow
          ? ("EMPLOYEE_BORROWING_ENABLED" as const)
          : ("EMPLOYEE_BORROWING_SUSPENDED" as const),
        title: input.canBorrow
          ? "Employee borrowing enabled"
          : "Employee borrowing suspended",
        actorLabel: actor.user.name,
        occurredAt: input.now,
        metadata: {
          targetUserId: employeeWithUser.userId,
          before: { canBorrow: employee.canBorrow },
          after: { canBorrow: input.canBorrow },
        },
      });
    if (employee.canLend !== input.canLend)
      events.push({
        organizationId: input.organizationId,
        actorMembershipId: actor.id,
        targetMembershipId: employee.id,
        type: input.canLend
          ? ("EMPLOYEE_LENDING_ENABLED" as const)
          : ("EMPLOYEE_LENDING_SUSPENDED" as const),
        title: input.canLend
          ? "Employee lending enabled"
          : "Employee lending suspended",
        actorLabel: actor.user.name,
        occurredAt: input.now,
        metadata: {
          targetUserId: employeeWithUser.userId,
          before: { canLend: employee.canLend },
          after: { canLend: input.canLend },
        },
      });
    if (events.length)
      await transaction.auditEvent.createMany({ data: events });
    return updated;
  });
}
