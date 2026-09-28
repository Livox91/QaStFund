import { z } from "zod";

const moneyPattern = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;

const repaymentAmount = z
  .string()
  .trim()
  .regex(moneyPattern, "Enter a valid amount with up to 2 decimals.")
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  })
  .refine((value) => value > 0n, "Repayment must be greater than zero.");

export const employeeLoanIdSchema = z.uuid();

export const repayLoanSchema = z.object({
  loanId: z.uuid(),
  amount: repaymentAmount,
  requestId: z.uuid(),
});
