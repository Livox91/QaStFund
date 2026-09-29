import { z } from "zod";

export const prepareOnChainBorrowSchema = z.object({
  requestId: z.uuid(),
});

export const confirmOnChainBorrowSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
