import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { getEmployerOverview } from "@/modules/organizations/application/get-employer-overview";
import { prismaEmployerOverviewRepository } from "@/modules/organizations/infrastructure/prisma-employer-overview-repository";

export function getEmployerOverviewForActor(actor: AuthenticatedActor) {
  return getEmployerOverview(actor, prismaEmployerOverviewRepository);
}
