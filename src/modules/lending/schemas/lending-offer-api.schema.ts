import { z } from "zod";

import type { CreateLendingOfferCommand } from "@/modules/lending/domain/lending-offer";

const moneyPattern = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;
const percentagePattern = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;
const DEFAULT_OFFER_WINDOW_DAYS = 30;

function decimalToMinorUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
}

function percentageToBasisPoints(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0"));
}

const positiveMoney = z
  .string()
  .trim()
  .regex(moneyPattern)
  .transform(decimalToMinorUnits)
  .refine((amount) => amount > 0n);

export const createLendingOfferApiSchema = z
  .object({
    amount: positiveMoney,
    interestRate: z
      .string()
      .trim()
      .regex(percentagePattern)
      .transform(percentageToBasisPoints)
      .refine((rate) => rate >= 0 && rate <= 10_000),
    termDays: z.number().int().min(1).max(365),
    maxAmountPerBorrower: positiveMoney,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.maxAmountPerBorrower > input.amount) {
      context.addIssue({
        code: "custom",
        path: ["maxAmountPerBorrower"],
        message: "Maximum amount per borrower cannot exceed the offer amount.",
      });
    }
  });

export function toCreateLendingOfferCommand(
  input: z.output<typeof createLendingOfferApiSchema>,
  now: Date,
): CreateLendingOfferCommand {
  return {
    amountMinorUnits: input.amount,
    minimumLoanAmountMinorUnits: 1n,
    maximumLoanAmountMinorUnits: input.maxAmountPerBorrower,
    durationDays: input.termDays,
    feeRateBasisPoints: input.interestRate,
    expiresAt: new Date(
      now.getTime() + DEFAULT_OFFER_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
    ),
  };
}

export const lendingOfferIdSchema = z.uuid();

export const updateLendingOfferStatusSchema = z
  .object({ status: z.enum(["ACTIVE", "PAUSED", "CLOSED"]) })
  .strict();
