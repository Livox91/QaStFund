"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdminPage } from "@/modules/auth/infrastructure/auth-guard";
import { EmployeeDirectoryError } from "@/modules/employee-directory/domain/employee-directory";
import { safeSyncErrorSummary } from "@/modules/employee-directory/application/sync-health";
import {
  configureEmployeeDirectoryCredentialsForActor,
  synchronizeEmployeesForActor,
  testEmployeeDirectoryConnectionForActor,
} from "@/modules/employee-directory/index.server";

export type IntegrationActionState = {
  status: "idle" | "success" | "partial" | "error";
  message: string;
};

const configSchema = z.object({
  baseUrl: z.url(),
  apiPath: z.string().min(1).max(128),
  apiVersion: z.string().min(1).max(16),
  authMethod: z.enum(["token", "oauth_bearer"]),
  apiKey: z.string().max(256).optional(),
  apiSecret: z.string().max(512).optional(),
  accessToken: z.string().max(4096).optional(),
  timeoutMs: z.coerce.number().int().min(500).max(30_000),
  activeStatus: z.enum(["ACTIVE", "SUSPENDED", "TERMINATED", "IGNORE"]),
  inactiveStatus: z.enum(["ACTIVE", "SUSPENDED", "TERMINATED", "IGNORE"]),
  leftStatus: z.enum(["ACTIVE", "SUSPENDED", "TERMINATED", "IGNORE"]),
  suspendedStatus: z.enum(["ACTIVE", "SUSPENDED", "TERMINATED", "IGNORE"]),
});

function safeMessage(error: unknown): string {
  if (error instanceof EmployeeDirectoryError) {
    return safeSyncErrorSummary(error.code);
  }
  if (error instanceof z.ZodError) return "INVALID_CONFIGURATION";
  if (error instanceof Error && error.message.startsWith("INVALID_")) {
    return error.message;
  }
  return "UNEXPECTED_ERROR";
}

export async function configureIntegrationAction(
  _state: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  try {
    const actor = await requireEmployerAdminPage();
    await enforceUserRateLimit(
      actor,
      "employer.integration.configure",
      "administrative",
    );
    const input = configSchema.parse(Object.fromEntries(formData));
    const status = (value: typeof input.activeStatus) =>
      value === "IGNORE" ? null : value;
    const apiKey = input.apiKey?.trim();
    const apiSecret = input.apiSecret?.trim();
    const accessToken = input.accessToken?.trim();
    if (
      input.authMethod === "token" &&
      Boolean(apiKey) !== Boolean(apiSecret)
    ) {
      return {
        status: "error",
        message: "Enter both the ERPNext API key and API secret.",
      };
    }
    const credential =
      input.authMethod === "token" && apiKey && apiSecret
        ? ({ method: "token", apiKey, apiSecret } as const)
        : input.authMethod === "oauth_bearer" && accessToken
          ? ({ method: "oauth_bearer", accessToken } as const)
          : undefined;
    await configureEmployeeDirectoryCredentialsForActor(actor, {
      baseUrl: input.baseUrl,
      apiPath: input.apiPath,
      apiVersion: input.apiVersion,
      authMethod: input.authMethod,
      ...(credential ? { credential } : {}),
      timeoutMs: input.timeoutMs,
      statusMapping: {
        active: status(input.activeStatus),
        inactive: status(input.inactiveStatus),
        left: status(input.leftStatus),
        suspended: status(input.suspendedStatus),
      },
    });
    revalidatePath("/employer/integrations");
    revalidatePath("/employer/employees");
    revalidatePath("/employer/employees");
    revalidatePath("/employer/onboarding");
    return { status: "success", message: "Integration configuration saved." };
  } catch (error) {
    return { status: "error", message: safeMessage(error) };
  }
}

export async function testIntegrationAction(): Promise<IntegrationActionState> {
  try {
    const actor = await requireEmployerAdminPage();
    await enforceUserRateLimit(actor, "employer.integration.test", "expensive");
    const result = await testEmployeeDirectoryConnectionForActor(actor);
    revalidatePath("/employer/integrations");
    revalidatePath("/employer/onboarding");
    return {
      status: result.ok ? "success" : "error",
      message: result.messageCode,
    };
  } catch (error) {
    return { status: "error", message: safeMessage(error) };
  }
}

export async function syncEmployeesAction(): Promise<IntegrationActionState> {
  try {
    const actor = await requireEmployerAdminPage();
    await enforceUserRateLimit(actor, "employer.integration.sync", "expensive");
    const result = await synchronizeEmployeesForActor(actor);
    revalidatePath("/employer/integrations");
    revalidatePath("/employer/onboarding");
    return {
      status: result.status === "partial" ? "partial" : "success",
      message:
        result.status === "partial"
          ? `Partial sync: added ${result.createdCount}, updated ${result.updatedCount}, reactivated ${result.reactivatedCount}, removed ${result.deactivatedCount}, unchanged ${result.unchangedCount}; ${result.reviewCount} need review and ${result.invitationFailureCount} invitation emails need retry.`
          : `Sync complete: added ${result.createdCount}, updated ${result.updatedCount}, reactivated ${result.reactivatedCount}, removed ${result.deactivatedCount}, unchanged ${result.unchangedCount}.`,
    };
  } catch (error) {
    revalidatePath("/employer/integrations");
    revalidatePath("/employer/employees");
    revalidatePath("/employer/onboarding");
    return { status: "error", message: safeMessage(error) };
  }
}
