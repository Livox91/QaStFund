import { getLivenessStatus } from "@/server/application/health/get-health-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(getLivenessStatus(), {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
