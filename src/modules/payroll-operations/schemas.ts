import { z } from "zod";

const money = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/)
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  })
  .refine((value) => value > 0n);

export const proposalIdSchema = z.uuid();

export const createPayrollProposalSchema = z
  .object({
    installmentId: z.uuid(),
    payrollPeriodStart: z.coerce.date(),
    payrollPeriodEnd: z.coerce.date(),
    proposedAmount: money,
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict();

export const payrollActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("APPROVE"),
    rationale: z.string().trim().min(1).max(1000),
  }),
  z.object({
    action: z.literal("REJECT"),
    rationale: z.string().trim().min(1).max(1000),
  }),
  z.object({ action: z.literal("SUBMIT") }),
  z.object({
    action: z.literal("RECONCILE"),
    actualAmount: money,
    externalReference: z.string().trim().min(1).max(140),
  }),
]);

export const delinquencyActionSchema = z
  .object({
    action: z.enum([
      "REVIEW",
      "CONTACT",
      "REQUEST_ARRANGEMENT",
      "RETRY_NOTIFICATION",
    ]),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
