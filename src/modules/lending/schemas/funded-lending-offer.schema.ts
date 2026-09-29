import { z } from "zod";

import { parsePercentToBasisPoints, parseUsdcCents } from "@/shared/money/usdc";

export const fundedLendingOfferSchema = z
  .object({
    requestId: z.uuid(),
    amount: z.string(),
    interestRate: z.string(),
    durationDays: z.number().int().min(1).max(365),
  })
  .transform((input, context) => {
    try {
      const amount = parseUsdcCents(input.amount);
      return {
        requestId: input.requestId,
        principalBaseUnits: amount.baseUnits,
        amountMinorUnits: amount.minorUnits,
        feeRateBasisPoints: parsePercentToBasisPoints(input.interestRate),
        durationDays: input.durationDays,
        durationSeconds: input.durationDays * 86_400,
      };
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid offer terms.",
      });
      return z.NEVER;
    }
  });

export const confirmFundedLendingOfferSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
