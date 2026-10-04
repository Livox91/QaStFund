import type {
  LivenessStatus,
  ReadinessStatus,
} from "@/server/domain/health/health-status";
import type { HealthRepository } from "@/server/repositories/health-repository";

export function getLivenessStatus(): LivenessStatus {
  return { status: "alive" };
}

export async function getReadinessStatus(
  healthRepository: HealthRepository,
  validateConfiguration: () => unknown,
): Promise<ReadinessStatus> {
  let configuration: "healthy" | "unhealthy" = "healthy";
  let database: "healthy" | "unhealthy" = "healthy";

  try {
    validateConfiguration();
  } catch {
    configuration = "unhealthy";
  }
  try {
    await healthRepository.ping();
  } catch {
    database = "unhealthy";
  }

  return {
    status:
      configuration === "healthy" && database === "healthy"
        ? "ready"
        : "not_ready",
    checks: { configuration, database },
  };
}

/** @deprecated Compatibility helper for callers that still expect an exception. */
export async function getHealthStatus(
  healthRepository: HealthRepository,
): Promise<{ status: "ok"; database: "connected" }> {
  await healthRepository.ping();

  return {
    status: "ok",
    database: "connected",
  };
}
