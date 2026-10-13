import { logger } from "@/infrastructure/logging/logger";
import { isAuthorizedSchedulerRequest } from "@/modules/employee-directory/infrastructure/scheduler-auth";
import { getConfiguredDependencyHealth } from "@/server/application/health/get-configured-dependency-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  return isAuthorizedSchedulerRequest(
    request.headers.get("authorization"),
    process.env.OPERATIONAL_HEALTH_SECRET,
  );
}

function unauthorized(): Response {
  return Response.json(
    { error: "UNAUTHORIZED" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

async function dependencyHealth(mode: "observe-and-record" | "read-only") {
  try {
    const report = await getConfiguredDependencyHealth({ mode });
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

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) return unauthorized();
  return dependencyHealth("read-only");
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) return unauthorized();
  return dependencyHealth("observe-and-record");
}
