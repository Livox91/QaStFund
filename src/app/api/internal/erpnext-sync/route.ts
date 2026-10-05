import { validateEnvironment } from "@/infrastructure/config/environment";
import { enforcePublicRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { runConfiguredScheduledEmployeeDirectorySyncs } from "@/modules/employee-directory/index.server";
import { isAuthorizedSchedulerRequest } from "@/modules/employee-directory/infrastructure/scheduler-auth";
import { RateLimitExceededError } from "@/shared/errors/rate-limit-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const environment = validateEnvironment();
  if (
    !environment.ERP_NEXT_SYNC_ENABLED ||
    !isAuthorizedSchedulerRequest(
      request.headers.get("authorization"),
      environment.ERP_NEXT_SYNC_CRON_SECRET,
    )
  ) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    await enforcePublicRateLimit(request, "internal.erpnext-sync", "public");
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return Response.json(
        { error: error.code },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    throw error;
  }
  const result = await runConfiguredScheduledEmployeeDirectorySyncs();
  return Response.json(result, { status: 200 });
}
