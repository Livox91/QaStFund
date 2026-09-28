import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  requireAuthenticatedUser,
  requireEmployee,
  requireEmployerAdmin,
} from "@/modules/auth/application/authorization";
import type { AuthenticatedActor } from "@/modules/auth/domain/actor";
import { getRoleHome } from "@/modules/auth/domain/application-role";
import { AUTH_SESSION_COOKIE } from "@/modules/auth/domain/session";
import { resolveAuthenticatedActor } from "@/modules/auth/infrastructure/auth-service";

export async function getCurrentActor(): Promise<AuthenticatedActor | null> {
  const sessionToken = (await cookies()).get(AUTH_SESSION_COOKIE)?.value;
  return resolveAuthenticatedActor(sessionToken);
}

export async function requireAuthenticatedPageUser(): Promise<AuthenticatedActor> {
  const actor = await getCurrentActor();

  if (!actor) {
    redirect("/sign-in");
  }

  return requireAuthenticatedUser(actor);
}

export async function requireEmployerAdminPage(): Promise<AuthenticatedActor> {
  const actor = await requireAuthenticatedPageUser();

  try {
    return requireEmployerAdmin(actor);
  } catch {
    redirect(getRoleHome(actor.role));
  }
}

export async function requireEmployeePage(): Promise<AuthenticatedActor> {
  const actor = await requireAuthenticatedPageUser();

  try {
    return requireEmployee(actor);
  } catch {
    redirect(getRoleHome(actor.role));
  }
}
