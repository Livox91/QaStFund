import { z } from "zod";

export const beginArcWalletEnrollmentSchema = z.object({
  intent: z.enum(["CREATE", "RECOVER"]),
});
