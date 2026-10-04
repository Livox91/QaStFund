export type HealthCheckStatus = "healthy" | "unhealthy";

export type LivenessStatus = Readonly<{ status: "alive" }>;

export type ReadinessStatus = Readonly<{
  status: "ready" | "not_ready";
  checks: {
    configuration: HealthCheckStatus;
    database: HealthCheckStatus;
  };
}>;

export type DependencyStatus = "disabled" | "healthy" | "stale" | "unhealthy";
