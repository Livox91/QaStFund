import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "A valid Arc address is required");

export const createArcWalletChallengeSchema = z.object({
  address: addressSchema,
});

export const completeArcWalletChallengeSchema = z.object({
  challengeId: z.uuid(),
  address: addressSchema,
  nonce: z.string().min(32).max(256),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, "A valid signature is required"),
});
