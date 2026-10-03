import { validateEnvironment } from "@/infrastructure/config/environment";
import { runConfiguredArcReconciliation } from "@/modules/blockchain-reconciliation/index.server";
import { isAuthorizedSchedulerRequest } from "@/modules/employee-directory/infrastructure/scheduler-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const environment = validateEnvironment();
  if (
    !environment.ARC_RECONCILIATION_ENABLED ||
    !isAuthorizedSchedulerRequest(
      request.headers.get("authorization"),
      environment.ARC_RECONCILIATION_CRON_SECRET,
    )
  ) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const result = await runConfiguredArcReconciliation();
  return Response.json(result, { status: 200 });
}
