import type { NextRequest } from "next/server";

import {
  handleAgentRoute,
  readJson,
} from "@/modules/repayment-agent/api/agent-route";
import { prepareRepaymentMandate } from "@/modules/repayment-agent/index.server";
import { prepareMandateSchema } from "@/modules/repayment-agent/schemas/repayment-agent.schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Records the requested limits and returns the passkey operation that sets them on-chain. */
export async function POST(request: NextRequest): Promise<Response> {
  return handleAgentRoute(request, {
    rateLimitKey: "repayment-agent.mandate.prepare",
    mutation: true,
    status: 201,
    run: async (actor) =>
      prepareRepaymentMandate(
        actor,
        await readJson(request, prepareMandateSchema),
      ),
  });
}
