import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { getEmployeeDashboard } from "@/modules/employees/application/get-employee-dashboard";
import { getEmployeeIdentity } from "@/modules/employees/application/get-employee-identity";
import { prismaEmployeeDashboardRepository } from "@/modules/employees/infrastructure/prisma-employee-dashboard-repository";
import { prismaEmployeeIdentityRepository } from "@/modules/employees/infrastructure/prisma-employee-identity-repository";

export function getEmployeeDashboardForActor(
  actor: AuthenticatedActor,
  now = new Date(),
) {
  return getEmployeeDashboard(actor, prismaEmployeeDashboardRepository, now);
}

export function getEmployeeIdentityForActor(actor: AuthenticatedActor | null) {
  return getEmployeeIdentity(actor, prismaEmployeeIdentityRepository);
}
