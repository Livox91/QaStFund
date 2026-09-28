import type { ApplicationRole } from "@/modules/auth/domain/application-role";

export type AuthenticatedActor = Readonly<{
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: ApplicationRole;
}>;
