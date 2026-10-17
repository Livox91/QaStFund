import { z } from "zod";

const usdcAmount = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/,
    "Enter a USDC amount with up to 2 decimals.",
  );

export const prepareMandateSchema = z
  .object({
    requestId: z.uuid(),
    maxPerRepaymentUsdc: usdcAmount,
    maxPerPeriodUsdc: usdcAmount,
    minimumReserveUsdc: usdcAmount,
    earliestBeforeDueDays: z.coerce.number().int().min(0).max(30),
    expiresInDays: z.coerce.number().int().min(1).max(366),
  })
  .strict();

export const transactionHashSchema = z
  .object({
    transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  })
  .strict();

export type PrepareMandateInput = z.infer<typeof prepareMandateSchema>;
