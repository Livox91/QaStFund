import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { getEmployeeDashboard } from "@/modules/employees/application/get-employee-dashboard";
import { prismaEmployeeDashboardRepository } from "@/modules/employees/infrastructure/prisma-employee-dashboard-repository";

export function getEmployeeDashboardForActor(
  actor: AuthenticatedActor,
  now = new Date(),
) {
  return getEmployeeDashboard(actor, prismaEmployeeDashboardRepository, now);
}
