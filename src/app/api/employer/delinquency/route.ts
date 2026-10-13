import { enforceUserRateLimit } from "@/infrastructure/rate-limit/rate-limit";
import { requireEmployerAdmin } from "@/modules/auth/application/authorization";
import { getCurrentActor } from "@/modules/auth/infrastructure/auth-guard";
import { listDelinquencyCases } from "@/modules/payroll-operations/index.server";
import { apiError, apiSuccess } from "@/shared/api/responses";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = requireEmployerAdmin(await getCurrentActor());
    await enforceUserRateLimit(actor, "delinquency.list", "administrative");
    const cases = await listDelinquencyCases(actor);
    return apiSuccess({
      cases: JSON.parse(
        JSON.stringify(cases, (_, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
