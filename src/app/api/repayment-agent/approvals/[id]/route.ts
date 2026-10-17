import type { NextRequest } from "next/server";
import { z } from "zod";

import { handleAgentRoute } from "@/modules/repayment-agent/api/agent-route";
import { prepareRepaymentApproval } from "@/modules/repayment-agent/index.server";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Returns the exact passkey operation for one of the agent's approval requests. */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/repayment-agent/approvals/[id]">,
): Promise<Response> {
  return handleAgentRoute(request, {
    rateLimitKey: "repayment-agent.approval.prepare",
    mutation: true,
    run: async (actor) => {
      const { id } = await context.params;
      if (!z.uuid().safeParse(id).success) {
        throw new ApplicationError(
          "APPROVAL_NOT_FOUND",
          "Approval request not found.",
          404,
        );
      }
      return prepareRepaymentApproval(actor, id);
    },
  });
}
