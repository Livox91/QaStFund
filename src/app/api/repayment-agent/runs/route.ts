import type { NextRequest } from "next/server";

import { handleAgentRoute } from "@/modules/repayment-agent/api/agent-route";
import { runRepaymentAgentForActor } from "@/modules/repayment-agent/index.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Runs the agent once for the signed-in borrower. */
export async function POST(request: NextRequest): Promise<Response> {
  return handleAgentRoute(request, {
    rateLimitKey: "repayment-agent.run",
    mutation: true,
    status: 201,
    run: async (actor) => {
      const summary = await runRepaymentAgentForActor(actor);
      return {
        run: {
          runId: summary.runId,
          status: summary.status,
          outcomeCode: summary.outcomeCode,
          summary: summary.summary,
        },
      };
    },
  });
}
