import { z } from "zod";

import { employerActionTypes } from "@/modules/employer-actions/domain/employer-action";

export const employerActionRequestSchema = z.object({
  loanId: z.uuid(),
  action: z.enum(employerActionTypes),
  idempotencyKey: z.uuid(),
});
