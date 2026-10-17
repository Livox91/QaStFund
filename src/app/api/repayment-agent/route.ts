import type { NextRequest } from "next/server";

import { handleAgentRoute } from "@/modules/repayment-agent/api/agent-route";
import { getRepaymentAgentOverview } from "@/modules/repayment-agent/index.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  return handleAgentRoute(request, {
    rateLimitKey: "repayment-agent.overview",
    mutation: false,
    run: async (actor) => ({
      overview: await getRepaymentAgentOverview(actor),
    }),
  });
}
