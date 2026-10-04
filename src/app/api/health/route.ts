import { prismaHealthRepository } from "@/infrastructure/database/repositories/prisma-health-repository";
import { validateEnvironment } from "@/infrastructure/config/environment";
import { logger } from "@/infrastructure/logging/logger";
import {
  operationalFailureAlertThreshold,
  recordOperationalFailure,
  recordOperationalSuccess,
} from "@/infrastructure/observability/operational-signals";
import { getReadinessStatus } from "@/server/application/health/get-health-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const health = await getReadinessStatus(
    prismaHealthRepository,
    validateEnvironment,
  );
  if (health.status === "not_ready") {
    logger.warn("Application readiness check failed", {
      checks: health.checks,
    });
    if (health.checks.database === "unhealthy") {
      recordOperationalFailure("database", {
        alertThreshold: operationalFailureAlertThreshold(),
      });
    }
  } else {
    recordOperationalSuccess("database");
  }
  return Response.json(health, {
    status: health.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
