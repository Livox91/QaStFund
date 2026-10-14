import { z } from "zod";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_USDC_ADDRESS,
  ARC_USDC_DECIMALS,
} from "@/integrations/arc/arc-testnet";

const evmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Enter a valid EVM wallet address.");

export const prepareArcUsdcTransferSchema = z
  .object({
    idempotencyKey: z.uuid(),
    recipient: evmAddressSchema,
    amount: z
      .string()
      .min(1)
      .max(80)
      .regex(
        new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${ARC_USDC_DECIMALS}})?$`),
        `Enter a positive USDC amount with no more than ${ARC_USDC_DECIMALS} decimal places.`,
      ),
    chainId: z.literal(ARC_TESTNET_CHAIN_ID),
    tokenAddress: z
      .string()
      .transform((value) => value.toLowerCase())
      .pipe(z.literal(ARC_USDC_ADDRESS.toLowerCase())),
  })
  .strict();

export const submitArcUsdcTransferSchema = z
  .object({
    userOperationHash: z
      .string()
      .regex(
        /^0x[0-9a-fA-F]{64}$/,
        "A valid Circle user operation hash is required.",
      ),
  })
  .strict();

export const confirmArcUsdcTransferSchema = z
  .object({
    transactionHash: z
      .string()
      .regex(
        /^0x[0-9a-fA-F]{64}$/,
        "A valid Arc transaction hash is required.",
      ),
  })
  .strict();

export const failArcUsdcTransferSchema = z
  .object({
    outcome: z.enum(["REJECTED", "UNKNOWN"]),
  })
  .strict();

export function parseUsdcBaseUnits(amount: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount)) {
    throw new Error("INVALID_USDC_AMOUNT");
  }
  const [whole, fraction = ""] = amount.split(".");
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (value <= 0n) throw new Error("INVALID_USDC_AMOUNT");
  return value;
}
