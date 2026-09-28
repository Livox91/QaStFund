import type {
  CurrentOrganization,
  OrganizationMember,
} from "@/modules/organizations/domain/organization-membership";

export interface OrganizationMembershipRepository {
  findOrganizationById(
    organizationId: string,
  ): Promise<CurrentOrganization | null>;
  listMembers(organizationId: string): Promise<readonly OrganizationMember[]>;
}
