import { validateEnvironment } from "@/infrastructure/config/environment";
import { logger } from "@/infrastructure/logging/logger";
import { runScheduledArcReconciliation } from "@/modules/blockchain-reconciliation/index.server";
import { isAuthorizedSchedulerRequest } from "@/modules/employee-directory/infrastructure/scheduler-auth";
import { runMonitoredJob } from "@/modules/operations/application/monitored-job";
import { prismaOperationalJobRepository } from "@/modules/operations/infrastructure/prisma-operational-job-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const environment = validateEnvironment();
  if (
    !environment.ARC_RECONCILIATION_ENABLED ||
    !isAuthorizedSchedulerRequest(
      request.headers.get("authorization"),
      environment.ARC_RECONCILIATION_CRON_SECRET,
    )
  ) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const result = await runMonitoredJob({
      jobKey: "arc-reconciliation",
      subsystem: "reconciliation",
      intervalSeconds: environment.ARC_RECONCILIATION_INTERVAL_SECONDS,
      safeErrorCode: "RECONCILIATION_FAILED",
      repository: prismaOperationalJobRepository,
      run: runScheduledArcReconciliation,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    logger.error("Scheduled Arc reconciliation request failed", error);
    return Response.json(
      { error: "RECONCILIATION_FAILED", retryable: true },
      { status: 503 },
    );
  }
}
