import { z } from "zod";

export const AGENT_ACTIONS = [
  "PAY_FULL",
  "PAY_PARTIAL",
  "WAIT",
  "NOTIFY_USER",
  "REQUEST_APPROVAL",
  "ESCALATE",
  "STOP",
] as const;

export type AgentAction = (typeof AGENT_ACTIONS)[number];

export const PAYMENT_ACTIONS: ReadonlySet<AgentAction> = new Set([
  "PAY_FULL",
  "PAY_PARTIAL",
]);

/** Actions that name a loan and an amount. */
export const AMOUNT_ACTIONS: ReadonlySet<AgentAction> = new Set([
  "PAY_FULL",
  "PAY_PARTIAL",
  "REQUEST_APPROVAL",
]);

const PAY: AgentAction[] = ["PAY_FULL", "PAY_PARTIAL"];
const ANY: AgentAction[] = [...AGENT_ACTIONS];

/**
 * Each reason code lists the actions it can justify. A decision whose reason
 * codes do not support its own action is rejected as inconsistent.
 */
export const REASON_SUPPORTS = {
  INSTALLMENT_DUE_SOON: [...PAY, "REQUEST_APPROVAL", "NOTIFY_USER", "ESCALATE"],
  INSTALLMENT_OVERDUE: [...PAY, "REQUEST_APPROVAL", "NOTIFY_USER", "ESCALATE"],
  BALANCE_ABOVE_RESERVE: PAY,
  BALANCE_BELOW_RESERVE: [
    "PAY_PARTIAL",
    "REQUEST_APPROVAL",
    "NOTIFY_USER",
    "ESCALATE",
    "WAIT",
  ],
  PAYMENT_WITHIN_MANDATE: PAY,
  PER_REPAYMENT_CAP_BINDING: ["PAY_PARTIAL", "REQUEST_APPROVAL", "WAIT"],
  PERIOD_CAP_BINDING: [
    "PAY_PARTIAL",
    "REQUEST_APPROVAL",
    "WAIT",
    "NOTIFY_USER",
  ],
  ALLOWANCE_INSUFFICIENT: [
    "PAY_PARTIAL",
    "REQUEST_APPROVAL",
    "NOTIFY_USER",
    "ESCALATE",
  ],
  PARTIAL_PAYMENT_REDUCES_DELINQUENCY_RISK: ["PAY_PARTIAL"],
  FULL_PAYMENT_CLOSES_LOAN: ["PAY_FULL"],
  EARLIER_DUE_PRIORITIZED: [...PAY, "REQUEST_APPROVAL", "WAIT"],
  MULTIPLE_OBLIGATIONS_COMPETING: [
    ...PAY,
    "REQUEST_APPROVAL",
    "WAIT",
    "NOTIFY_USER",
  ],
  NOT_YET_IN_REPAYMENT_WINDOW: ["WAIT", "NOTIFY_USER"],
  NO_OUTSTANDING_OBLIGATIONS: ["WAIT", "STOP"],
  MANDATE_MISSING_OR_INACTIVE: [
    "NOTIFY_USER",
    "REQUEST_APPROVAL",
    "ESCALATE",
    "WAIT",
  ],
  MANDATE_EXPIRING: ["NOTIFY_USER", ...PAY, "WAIT"],
  RECONCILIATION_UNHEALTHY: ["STOP", "ESCALATE"],
  OPERATION_IN_FLIGHT: ["WAIT", "STOP"],
  INSUFFICIENT_FUNDS: [
    "ESCALATE",
    "NOTIFY_USER",
    "REQUEST_APPROVAL",
    "PAY_PARTIAL",
  ],
  UNEXPECTED_BALANCE_CHANGE: ANY,
  PREVIOUS_ATTEMPT_FAILED: ANY,
  HUMAN_APPROVAL_REQUIRED: ["REQUEST_APPROVAL", "ESCALATE"],
  AWAITING_EXISTING_APPROVAL: ["WAIT", "NOTIFY_USER"],
  RECENTLY_PAID: ["WAIT", "NOTIFY_USER", "REQUEST_APPROVAL", "STOP"],
} as const satisfies Record<string, ReadonlyArray<AgentAction>>;

export type AgentReasonCode = keyof typeof REASON_SUPPORTS;
export const AGENT_REASON_CODES = Object.keys(
  REASON_SUPPORTS,
) as AgentReasonCode[];

export type RejectedAlternative = Readonly<{
  action: AgentAction;
  reason: string;
}>;

/** The planner's structured output. No free-form transaction fields exist. */
export type AgentDecision = Readonly<{
  action: AgentAction;
  loanRef: string | null;
  amountBaseUnits: string | null;
  reasonCodes: ReadonlyArray<AgentReasonCode>;
  explanation: string;
  rejectedAlternatives: ReadonlyArray<RejectedAlternative>;
  confidence: number;
  nextReviewInHours: number | null;
}>;

export const agentDecisionSchema = z
  .object({
    action: z.enum(AGENT_ACTIONS),
    loanRef: z
      .string()
      .regex(/^L\d{1,3}$/)
      .nullable(),
    amountBaseUnits: z
      .string()
      .regex(/^[1-9]\d{0,17}$/)
      .nullable(),
    reasonCodes: z
      .array(
        z.enum(AGENT_REASON_CODES as [AgentReasonCode, ...AgentReasonCode[]]),
      )
      .min(1)
      .max(6),
    explanation: z.string().trim().min(10).max(500),
    rejectedAlternatives: z
      .array(
        z
          .object({
            action: z.enum(AGENT_ACTIONS),
            reason: z.string().trim().min(5).max(300),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    confidence: z.number().min(0).max(1),
    nextReviewInHours: z.number().int().min(1).max(168).nullable(),
  })
  .strict();

/**
 * JSON Schema for the model's `submit_decision` tool. Strict mode: every
 * property is required and no additional properties may appear, so the model
 * cannot smuggle a contract address, recipient or calldata into a decision.
 */
export const agentDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "loanRef",
    "amountBaseUnits",
    "reasonCodes",
    "explanation",
    "rejectedAlternatives",
    "confidence",
    "nextReviewInHours",
  ],
  properties: {
    action: { type: "string", enum: [...AGENT_ACTIONS] },
    loanRef: {
      type: ["string", "null"],
      description:
        "Obligation reference such as L1; null for actions without a loan.",
    },
    amountBaseUnits: {
      type: ["string", "null"],
      description:
        "USDC base units (6 decimals) as a decimal integer string; null unless paying or requesting approval.",
    },
    reasonCodes: {
      type: "array",
      items: { type: "string", enum: AGENT_REASON_CODES },
    },
    explanation: {
      type: "string",
      description:
        "One or two sentences for the borrower. State the amount for payment or approval actions.",
    },
    rejectedAlternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "reason"],
        properties: {
          action: { type: "string", enum: [...AGENT_ACTIONS] },
          reason: { type: "string" },
        },
      },
    },
    confidence: { type: "number" },
    nextReviewInHours: {
      type: ["integer", "null"],
      description: "When to re-evaluate after WAIT, in hours (1-168).",
    },
  },
} as const;
