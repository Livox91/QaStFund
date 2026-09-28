import { z } from "zod";

const moneyPattern = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;
const percentagePattern = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function decimalToScaledInteger(value: string, scaleDigits: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  const scale = 10n ** BigInt(scaleDigits);
  const scaledFraction = fraction.padEnd(scaleDigits, "0");

  return BigInt(whole) * scale + BigInt(scaledFraction || "0");
}

const moneyInput = (label: string) =>
  z
    .string()
    .trim()
    .regex(
      moneyPattern,
      `${label} must be a valid amount with up to 2 decimals.`,
    )
    .transform((value) => decimalToScaledInteger(value, 2))
    .refine((value) => value > 0n, `${label} must be greater than zero.`);

const dateInput = z
  .string()
  .trim()
  .regex(isoDatePattern, "Enter a valid expiration date.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Enter a valid expiration date.")
  .transform((value) => new Date(`${value}T23:59:59.999Z`));

export function createLendingOfferSchema(now = new Date()) {
  return z
    .object({
      amountAvailable: moneyInput("Amount available"),
      minimumLoanAmount: moneyInput("Minimum loan amount"),
      maximumLoanAmount: moneyInput("Maximum loan amount"),
      durationDays: z
        .string()
        .trim()
        .regex(/^\d+$/, "Duration must be a whole number of days.")
        .transform(Number)
        .pipe(
          z
            .number()
            .int()
            .min(1, "Duration must be at least 1 day.")
            .max(365, "Duration cannot exceed 365 days."),
        ),
      feeRatePercent: z
        .string()
        .trim()
        .regex(
          percentagePattern,
          "Fee rate must be a percentage with up to 2 decimals.",
        )
        .transform((value) => Number(decimalToScaledInteger(value, 2)))
        .refine((value) => value <= 10_000, "Fee rate cannot exceed 100%."),
      expirationDate: dateInput,
    })
    .superRefine((input, context) => {
      if (input.minimumLoanAmount > input.maximumLoanAmount) {
        context.addIssue({
          code: "custom",
          path: ["minimumLoanAmount"],
          message: "Minimum loan amount cannot exceed the maximum.",
        });
      }

      if (input.maximumLoanAmount > input.amountAvailable) {
        context.addIssue({
          code: "custom",
          path: ["maximumLoanAmount"],
          message: "Maximum loan amount cannot exceed the amount available.",
        });
      }

      if (input.expirationDate.getTime() <= now.getTime()) {
        context.addIssue({
          code: "custom",
          path: ["expirationDate"],
          message: "Expiration date must be in the future.",
        });
      }
    })
    .transform((input) => ({
      amountMinorUnits: input.amountAvailable,
      minimumLoanAmountMinorUnits: input.minimumLoanAmount,
      maximumLoanAmountMinorUnits: input.maximumLoanAmount,
      durationDays: input.durationDays,
      feeRateBasisPoints: input.feeRatePercent,
      expiresAt: input.expirationDate,
    }));
}

export type CreateLendingOfferInput = z.input<
  ReturnType<typeof createLendingOfferSchema>
>;
