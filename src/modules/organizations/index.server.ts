import "server-only";

import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  getCurrentOrganization,
  listCurrentOrganizationMembers,
} from "@/modules/organizations/application/get-current-organization";
import { getEmployerOverview } from "@/modules/organizations/application/get-employer-overview";
import { prismaEmployerOverviewRepository } from "@/modules/organizations/infrastructure/prisma-employer-overview-repository";
import { prismaOrganizationMembershipRepository } from "@/modules/organizations/infrastructure/prisma-organization-membership-repository";

export function getEmployerOverviewForActor(actor: AuthenticatedActor) {
  return getEmployerOverview(actor, prismaEmployerOverviewRepository);
}

export function getCurrentOrganizationForActor(actor: AuthenticatedActor) {
  return getCurrentOrganization(actor, prismaOrganizationMembershipRepository);
}

export function listCurrentOrganizationMembersForActor(
  actor: AuthenticatedActor,
) {
  return listCurrentOrganizationMembers(
    actor,
    prismaOrganizationMembershipRepository,
  );
}
