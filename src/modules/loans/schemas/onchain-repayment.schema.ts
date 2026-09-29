import { z } from "zod";

export const prepareOnChainRepaymentSchema = z.object({
  requestId: z.uuid(),
});

export const confirmOnChainRepaymentSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
