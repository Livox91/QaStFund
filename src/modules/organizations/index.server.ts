import "server-only";

import { validateTestnetEnvironment } from "@/infrastructure/config/environment";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import {
  getEmployerOnboarding,
  setEmployerErpNextEnabled,
  startInitialEmployeeSynchronization,
  updateEmployerOrganizationName,
} from "@/modules/organizations/application/employer-onboarding";
import {
  getCurrentOrganization,
  listCurrentOrganizationMembers,
} from "@/modules/organizations/application/get-current-organization";
import { getEmployerOverview } from "@/modules/organizations/application/get-employer-overview";
import { prismaEmployerOverviewRepository } from "@/modules/organizations/infrastructure/prisma-employer-overview-repository";
import { prismaEmployerOnboardingRepository } from "@/modules/organizations/infrastructure/prisma-employer-onboarding-repository";
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

function blockchainTestnetConfigured(): boolean {
  try {
    validateTestnetEnvironment();
    return true;
  } catch {
    return false;
  }
}

export function getEmployerOnboardingForActor(
  actor: AuthenticatedActor | null,
) {
  return getEmployerOnboarding(
    actor,
    prismaEmployerOnboardingRepository,
    blockchainTestnetConfigured(),
  );
}

export function updateEmployerOrganizationNameForActor(
  actor: AuthenticatedActor | null,
  name: string,
) {
  return updateEmployerOrganizationName(
    actor,
    name,
    prismaEmployerOnboardingRepository,
  );
}

export function setEmployerErpNextEnabledForActor(
  actor: AuthenticatedActor | null,
  enabled: boolean,
) {
  return setEmployerErpNextEnabled(
    actor,
    enabled,
    prismaEmployerOnboardingRepository,
  );
}

export function startInitialEmployeeSynchronizationForActor<T>(
  actor: AuthenticatedActor | null,
  synchronize: (actor: AuthenticatedActor) => Promise<T>,
) {
  return startInitialEmployeeSynchronization(
    actor,
    prismaEmployerOnboardingRepository,
    synchronize,
  );
}
