import type { AuthenticatedActor } from "@/modules/auth/domain/actor";

export function toCurrentSession(actor: AuthenticatedActor) {
  return {
    user: {
      id: actor.userId,
      email: actor.email,
      name: actor.name,
    },
    organization: {
      id: actor.organizationId,
      name: actor.organizationName,
      slug: actor.organizationSlug,
    },
    role: actor.role,
  } as const;
}
