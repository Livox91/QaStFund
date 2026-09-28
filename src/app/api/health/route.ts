import { prismaHealthRepository } from "@/infrastructure/database/repositories/prisma-health-repository";
import { logger } from "@/infrastructure/logging/logger";
import { getHealthStatus } from "@/server/application/health/get-health-status";
import { apiError, apiSuccess } from "@/shared/api/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const health = await getHealthStatus(prismaHealthRepository);
    return apiSuccess(health);
  } catch (error) {
    logger.error("Health check failed", error);
    return apiError(error);
  }
}
