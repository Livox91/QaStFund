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
      select: { id: true, canBorrow: true },
    });
    if (!membership) return null;
    const [policy, obligations] = await Promise.all([
      ensureOrganizationPolicy(transaction, input.organizationId),
      calculateBorrowerObligations(
        transaction,
        input.organizationId,
        membership.id,
      ),
    ]);
    return calculateBorrowingCapacity(policy, membership, obligations);
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
        canBorrow: true,
        canLend: true,
        user: { select: { id: true, name: true } },
      },
    });
    return Promise.all(
      employees.map(async (employee) => ({
        id: employee.id,
        userId: employee.user.id,
        name: employee.user.name,
        isActive: employee.isActive,
        canBorrow: employee.canBorrow,
        canLend: employee.canLend,
        ...(await calculateBorrowerObligations(
          transaction,
          organizationId,
          employee.id,
        )),
      })),
    );
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
