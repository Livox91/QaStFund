import type { ApplicationRole } from "@/modules/auth/domain/application-role";

export type CurrentOrganization = Readonly<{
  id: string;
  name: string;
  slug: string;
  currency: string;
}>;

export type OrganizationMember = Readonly<{
  id: string;
  userId: string;
  name: string;
  email: string;
  role: ApplicationRole;
  employmentStatus: "ACTIVE" | "SUSPENDED" | "TERMINATED";
  isActive: boolean;
  joinedAt: Date;
}>;
