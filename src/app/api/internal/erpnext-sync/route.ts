import { validateEnvironment } from "@/infrastructure/config/environment";
import { runConfiguredScheduledEmployeeDirectorySyncs } from "@/modules/employee-directory/index.server";
import { isAuthorizedSchedulerRequest } from "@/modules/employee-directory/infrastructure/scheduler-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const environment = validateEnvironment();
  if (
    !environment.ERP_NEXT_SYNC_ENABLED ||
    !isAuthorizedSchedulerRequest(
      request.headers.get("authorization"),
      environment.ERP_NEXT_SYNC_CRON_SECRET,
    )
  ) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const result = await runConfiguredScheduledEmployeeDirectorySyncs();
  return Response.json(result, { status: 200 });
}
