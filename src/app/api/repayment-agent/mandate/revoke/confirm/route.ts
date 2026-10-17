import type { NextRequest } from "next/server";

import {
  handleAgentRoute,
  readJson,
} from "@/modules/repayment-agent/api/agent-route";
import { confirmMandateRevocation } from "@/modules/repayment-agent/index.server";
import { transactionHashSchema } from "@/modules/repayment-agent/schemas/repayment-agent.schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  return handleAgentRoute(request, {
    rateLimitKey: "repayment-agent.mandate.revoke-confirm",
    mutation: true,
    run: async (actor) => {
      const { transactionHash } = await readJson(
        request,
        transactionHashSchema,
      );
      return confirmMandateRevocation(actor, transactionHash as `0x${string}`);
    },
  });
}
