import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  handleAgentRoute,
  readJson,
} from "@/modules/repayment-agent/api/agent-route";
import { confirmRepaymentMandate } from "@/modules/repayment-agent/index.server";
import { transactionHashSchema } from "@/modules/repayment-agent/schemas/repayment-agent.schema";
import { ApplicationError } from "@/shared/errors/application-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/repayment-agent/mandate/[id]/confirm">,
): Promise<Response> {
  return handleAgentRoute(request, {
    rateLimitKey: "repayment-agent.mandate.confirm",
    mutation: true,
    run: async (actor) => {
      const { id } = await context.params;
      if (!z.uuid().safeParse(id).success) {
        throw new ApplicationError(
          "MANDATE_NOT_FOUND",
          "Mandate not found.",
          404,
        );
      }
      const { transactionHash } = await readJson(
        request,
        transactionHashSchema,
      );
      return confirmRepaymentMandate(
        actor,
        id,
        transactionHash as `0x${string}`,
      );
    },
  });
}
