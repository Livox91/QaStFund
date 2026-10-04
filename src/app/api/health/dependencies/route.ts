import { logger } from "@/infrastructure/logging/logger";
import { getConfiguredDependencyHealth } from "@/server/application/health/get-configured-dependency-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const report = await getConfiguredDependencyHealth();
    return Response.json(report, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logger.error("Dependency health check failed", error);
    return Response.json(
      { status: "degraded", error: "Dependency health check failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
