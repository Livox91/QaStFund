import { after, type NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/infrastructure/logging/logger";
import {
  handleAgentRoute,
  readJson,
} from "@/modules/repayment-agent/api/agent-route";
import {
  confirmRepaymentApproval,
  runApprovalFollowUp,
} from "@/modules/repayment-agent/index.server";
import { transactionHashSchema } from "@/modules/repayment-agent/schemas/repayment-agent.schema";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/repayment-agent/approvals/[id]/confirm">,
): Promise<Response> {
  return handleAgentRoute(request, {
    rateLimitKey: "repayment-agent.approval.confirm",
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
      const { transactionHash } = await readJson(
        request,
        transactionHashSchema,
      );
      const result = await confirmRepaymentApproval(
        actor,
        id,
        transactionHash as `0x${string}`,
      );
      if (result.runFollowUp && result.borrower && result.parentRunId) {
        const { borrower, parentRunId } = result;
        // Replan against the new balances once the response has been sent.
        after(async () => {
          try {
            await runApprovalFollowUp(borrower, parentRunId);
          } catch (error) {
            logger.error("Repayment agent follow-up run failed", error);
          }
        });
      }
      return { status: result.status };
    },
  });
}
