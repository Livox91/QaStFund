import { z } from "zod";

import { LendingMarketplaceSort } from "@/modules/lending/domain/lending-offer";

const amountPattern = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;

function amountToMinorUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
}

const optionalAmount = z
  .union([
    z.literal("").transform(() => undefined),
    z
      .string()
      .trim()
      .regex(amountPattern)
      .transform(amountToMinorUnits)
      .refine((amount) => amount > 0n),
  ])
  .optional()
  .catch(undefined);

const optionalDuration = z
  .union([
    z.literal("").transform(() => undefined),
    z.coerce.number().int().min(1).max(365),
  ])
  .optional()
  .catch(undefined);

export const lendingMarketplaceQuerySchema = z.object({
  amountMinorUnits: optionalAmount,
  maximumDurationDays: optionalDuration,
  sort: z
    .enum([
      LendingMarketplaceSort.LOWEST_FEE,
      LendingMarketplaceSort.MOST_AVAILABLE,
      LendingMarketplaceSort.SHORTEST_DURATION,
      LendingMarketplaceSort.EXPIRING_SOON,
    ])
    .catch(LendingMarketplaceSort.LOWEST_FEE),
});
