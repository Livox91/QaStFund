import { z } from "zod";

import { parseUsdcCents } from "@/shared/money/usdc";

export const prepareOnChainRepaymentSchema = z.object({
  requestId: z.uuid(),
  amount: z
    .string()
    .trim()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/)
    .transform((value, context) => {
      try {
        return parseUsdcCents(value).baseUnits;
      } catch (error) {
        context.addIssue({
          code: "custom",
          message:
            error instanceof Error ? error.message : "Invalid USDC amount.",
        });
        return z.NEVER;
      }
    })
    .optional(),
});

export const confirmOnChainRepaymentSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
