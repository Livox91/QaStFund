import { validateEnvironment } from "@/infrastructure/config/environment";
import { logger } from "@/infrastructure/logging/logger";
import { enforcePublicRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { runConfiguredScheduledEmployeeDirectorySyncs } from "@/modules/employee-directory/index.server";
import { isAuthorizedSchedulerRequest } from "@/modules/employee-directory/infrastructure/scheduler-auth";
import { runMonitoredJob } from "@/modules/operations/application/monitored-job";
import { prismaOperationalJobRepository } from "@/modules/operations/infrastructure/prisma-operational-job-repository";
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
  try {
    const result = await runMonitoredJob({
      jobKey: "erpnext-sync",
      subsystem: "erpnext",
      intervalSeconds: environment.ERP_NEXT_SYNC_INTERVAL_MINUTES * 60,
      safeErrorCode: "ERP_NEXT_SYNC_FAILED",
      repository: prismaOperationalJobRepository,
      run: async () => {
        const value = await runConfiguredScheduledEmployeeDirectorySyncs();
        if (value.partial > 0 || value.failed > 0) {
          throw new Error("ERP_NEXT_SYNC_INCOMPLETE");
        }
        return value;
      },
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    logger.error("Scheduled ERPNext synchronization request failed", error);
    return Response.json(
      { error: "ERP_NEXT_SYNC_FAILED", retryable: true },
      { status: 503 },
    );
  }
}
