import { z } from "zod";

const money = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/)
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  });
const percent = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/)
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0") || "0");
  });

export const lendingPolicySchema = z
  .object({
    lendingEnabled: z.boolean(),
    borrowingEnabled: z.boolean(),
    maxLoanAmount: money,
    maxOutstandingDebt: money,
    maxActiveLoans: z.number().int().positive(),
    minInterestRate: percent,
    maxInterestRate: percent,
    minTermDays: z.number().int().positive(),
    maxTermDays: z.number().int().positive(),
  })
  .strict();

export const lendingAccessSchema = z
  .object({ canBorrow: z.boolean(), canLend: z.boolean() })
  .strict();
export const employeeIdSchema = z.uuid();
