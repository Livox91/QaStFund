import "server-only";

import {
  requireAuthenticatedUser,
  requireEmployee,
  requireEmployerAdmin,
} from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  EmployeeLendingAccessNotFoundError,
  InvalidLendingPolicyError,
} from "@/modules/policies/application/errors";
import {
  validatePolicyConfiguration,
  type LendingPolicyValues,
} from "@/modules/policies/domain/lending-policy";
import {
  getEmployeeBorrowingCapacity,
  getEmployeeProfileForOrganization,
  getOrganizationPolicy,
  listEmployeesWithLendingAccess,
  updateEmployeeLendingAccess,
  updateOrganizationPolicy,
} from "@/modules/policies/infrastructure/prisma-lending-policy-repository";

export function getPolicyForActor(actor: AuthenticatedActor | null) {
  return getOrganizationPolicy(requireAuthenticatedUser(actor).organizationId);
}
export function getEmployerPolicyForActor(actor: AuthenticatedActor | null) {
  return getOrganizationPolicy(requireEmployerAdmin(actor).organizationId);
}
export async function updatePolicyForActor(
  actor: AuthenticatedActor | null,
  values: LendingPolicyValues,
  now = new Date(),
) {
  const admin = requireEmployerAdmin(actor);
  if (!validatePolicyConfiguration(values))
    throw new InvalidLendingPolicyError();
  const policy = await updateOrganizationPolicy({
    organizationId: admin.organizationId,
    actorUserId: admin.userId,
    values,
    now,
  });
  if (!policy) throw new InvalidLendingPolicyError();
  return policy;
}
export async function getBorrowingCapacityForActor(
  actor: AuthenticatedActor | null,
) {
  const employee = requireEmployee(actor);
  const capacity = await getEmployeeBorrowingCapacity({
    organizationId: employee.organizationId,
    userId: employee.userId,
  });
  if (!capacity) throw new EmployeeLendingAccessNotFoundError();
  return capacity;
}
export function listEmployerEmployeesForActor(
  actor: AuthenticatedActor | null,
) {
  const admin = requireEmployerAdmin(actor);
  return listEmployeesWithLendingAccess(admin.organizationId);
}
export async function getEmployerEmployeeProfileForActor(
  actor: AuthenticatedActor | null,
  employeeMembershipId: string,
) {
  const admin = requireEmployerAdmin(actor);
  const employee = await getEmployeeProfileForOrganization({
    organizationId: admin.organizationId,
    employeeMembershipId,
  });
  if (!employee) throw new EmployeeLendingAccessNotFoundError();
  return employee;
}
export async function updateEmployeeAccessForActor(
  actor: AuthenticatedActor | null,
  employeeMembershipId: string,
  access: { canBorrow: boolean; canLend: boolean },
  now = new Date(),
) {
  const admin = requireEmployerAdmin(actor);
  const updated = await updateEmployeeLendingAccess({
    organizationId: admin.organizationId,
    actorUserId: admin.userId,
    employeeMembershipId,
    ...access,
    now,
  });
  if (!updated) throw new EmployeeLendingAccessNotFoundError();
  return updated;
}
