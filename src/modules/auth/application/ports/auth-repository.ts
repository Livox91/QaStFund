import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import type { ApplicationRole } from "@/modules/auth/domain/application-role";

export type AuthenticationMembership = Readonly<{
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: ApplicationRole;
}>;

export type AuthenticationUser = Readonly<{
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  memberships: readonly AuthenticationMembership[];
}>;

export interface AuthRepository {
  findUserForAuthentication(email: string): Promise<AuthenticationUser | null>;
  createSession(input: {
    tokenHash: string;
    userId: string;
    organizationId: string;
    expiresAt: Date;
  }): Promise<void>;
  findActorBySessionTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthenticatedActor | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
}
