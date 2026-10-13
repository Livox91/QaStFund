import { logger } from "@/infrastructure/logging/logger";
import { enforcePublicRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { isAuthorizedSchedulerRequest } from "@/modules/employee-directory/infrastructure/scheduler-auth";
import { runMonitoredJob } from "@/modules/operations/application/monitored-job";
import { prismaOperationalJobRepository } from "@/modules/operations/infrastructure/prisma-operational-job-repository";
import {
  evaluateOverdueInstallments,
  generatePayrollProposalsForCurrentPeriod,
} from "@/modules/payroll-operations/index.server";
import { RateLimitExceededError } from "@/shared/errors/rate-limit-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (
    !isAuthorizedSchedulerRequest(
      request.headers.get("authorization"),
      process.env.REPAYMENT_OPERATIONS_CRON_SECRET,
    )
  ) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    await enforcePublicRateLimit(
      request,
      "internal.repayment-operations",
      "public",
    );
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
      jobKey: "repayment-operations",
      subsystem: "repayments",
      intervalSeconds: safeIntervalSeconds(),
      safeErrorCode: "REPAYMENT_OPERATIONS_FAILED",
      repository: prismaOperationalJobRepository,
      run: async () => ({
        payroll: await generatePayrollProposalsForCurrentPeriod(),
        overdue: await evaluateOverdueInstallments(),
      }),
    });
    return Response.json(result);
  } catch (error) {
    logger.error("Scheduled repayment operations failed", error);
    return Response.json(
      { error: "REPAYMENT_OPERATIONS_FAILED", retryable: true },
      { status: 503 },
    );
  }
}

function safeIntervalSeconds() {
  const value = Number(
    process.env.REPAYMENT_OPERATIONS_INTERVAL_MINUTES ?? "60",
  );
  return Number.isSafeInteger(value) && value > 0 ? value * 60 : 3600;
}
