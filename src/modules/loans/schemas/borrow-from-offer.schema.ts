import { z } from "zod";

const moneyPattern = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;

const amountInput = z
  .string()
  .trim()
  .regex(moneyPattern, "Enter a valid amount with up to 2 decimals.")
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  })
  .refine((value) => value > 0n, "Amount must be greater than zero.");

export const borrowOfferParamsSchema = z.object({ offerId: z.uuid() });

export const borrowOfferAmountSchema = z.object({ amount: amountInput });

export const borrowOfferApiSchema = z.object({ amount: amountInput }).strict();

export const borrowIdempotencyKeySchema = z.uuid();
export const loanIdSchema = z.uuid();

export const confirmBorrowOfferSchema = z.object({
  offerId: z.uuid(),
  amount: amountInput,
  requestId: z.uuid(),
});
