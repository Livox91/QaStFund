import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { getEmployeeDashboard } from "@/modules/employees/application/get-employee-dashboard";
import { getEmployeeIdentity } from "@/modules/employees/application/get-employee-identity";
import { prismaEmployeeDashboardRepository } from "@/modules/employees/infrastructure/prisma-employee-dashboard-repository";
import { prismaEmployeeIdentityRepository } from "@/modules/employees/infrastructure/prisma-employee-identity-repository";
import { evaluateEmployeeLoansForActor } from "@/modules/loan-decisions/index.server";

export async function getEmployeeDashboardForActor(
  actor: AuthenticatedActor,
  now = new Date(),
) {
  await evaluateEmployeeLoansForActor(actor);
  return getEmployeeDashboard(actor, prismaEmployeeDashboardRepository, now);
}

export function getEmployeeIdentityForActor(actor: AuthenticatedActor | null) {
  return getEmployeeIdentity(actor, prismaEmployeeIdentityRepository);
}
