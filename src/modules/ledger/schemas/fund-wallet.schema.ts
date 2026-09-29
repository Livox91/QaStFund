import { z } from "zod";

const amount = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/)
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  })
  .refine((value) => value > 0n);

export const fundWalletSchema = z.object({ amount }).strict();
export const fundWalletIdempotencyKeySchema = z.uuid();
