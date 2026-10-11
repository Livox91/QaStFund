import { z } from "zod";

export const originationDecisionIdSchema = z.uuid();

export const originationDecisionStatusSchema = z.enum([
  "APPROVAL_CONSIDERATION",
  "REVIEW_REQUIRED",
  "NOT_ELIGIBLE",
]);

export const originationDecisionOverrideSchema = z.object({
  outcome: z.enum(["APPROVED", "REJECTED"]),
  rationale: z.string().trim().min(20).max(1_000),
});
