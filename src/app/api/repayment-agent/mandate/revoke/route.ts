import type { NextRequest } from "next/server";

import { handleAgentRoute } from "@/modules/repayment-agent/api/agent-route";
import { prepareMandateRevocation } from "@/modules/repayment-agent/index.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Returns the passkey operation that revokes the mandate and clears the allowance. */
export async function POST(request: NextRequest): Promise<Response> {
  return handleAgentRoute(request, {
    rateLimitKey: "repayment-agent.mandate.revoke",
    mutation: true,
    run: async () => prepareMandateRevocation(),
  });
}
