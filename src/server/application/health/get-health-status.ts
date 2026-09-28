import type { HealthStatus } from "@/server/domain/health/health-status";
import type { HealthRepository } from "@/server/repositories/health-repository";

export async function getHealthStatus(
  healthRepository: HealthRepository,
): Promise<HealthStatus> {
  await healthRepository.ping();

  return {
    status: "ok",
    database: "connected",
  };
}
