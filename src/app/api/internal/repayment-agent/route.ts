import { logger } from "@/infrastructure/logging/logger";
import { isAuthorizedSchedulerRequest } from "@/modules/employee-directory/infrastructure/scheduler-auth";
import { runMonitoredJob } from "@/modules/operations/application/monitored-job";
import { prismaOperationalJobRepository } from "@/modules/operations/infrastructure/prisma-operational-job-repository";
import { runScheduledRepaymentAgents } from "@/modules/repayment-agent/index.server";
import { ApplicationError } from "@/shared/errors/application-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function intervalSeconds() {
  const minutes = Number(process.env.REPAYMENT_AGENT_INTERVAL_MINUTES ?? "60");
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes * 60 : 3_600;
}

export async function POST(request: Request) {
  if (
    !isAuthorizedSchedulerRequest(
      request.headers.get("authorization"),
      process.env.REPAYMENT_AGENT_CRON_SECRET,
    )
  ) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const result = await runMonitoredJob({
      jobKey: "repayment-agent",
      subsystem: "repayments",
      intervalSeconds: intervalSeconds(),
      safeErrorCode: "REPAYMENT_AGENT_FAILED",
      repository: prismaOperationalJobRepository,
      run: runScheduledRepaymentAgents,
    });
    return Response.json({
      considered: result.considered,
      paymentsOrApprovals: result.paymentsOrApprovals,
      failed: result.failed,
    });
  } catch (error) {
    if (
      error instanceof ApplicationError &&
      error.code === "REPAYMENT_AGENT_NOT_CONFIGURED"
    ) {
      return Response.json({ status: "DISABLED" });
    }
    logger.error("Scheduled repayment agent failed", error);
    return Response.json(
      { error: "REPAYMENT_AGENT_FAILED", retryable: true },
      { status: 503 },
    );
  }
}
