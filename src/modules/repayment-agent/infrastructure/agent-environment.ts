import { z } from "zod";

/** Treats `KEY=""` in an env file as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const privateKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex private key");

const agentEnvironmentSchema = z
  .object({
    REPAYMENT_AGENT_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ARC_ESCROW_VERSION: z.enum(["1", "3"]).default("1"),
    ARC_RPC_URL: z.url().default("https://rpc.testnet.arc.io"),
    ARC_REPAYMENT_AGENT_PRIVATE_KEY: optional(privateKey),
    ARC_BORROW_AUTHORIZER_PRIVATE_KEY: optional(z.string()),
    REPAYMENT_AGENT_CRON_SECRET: optional(z.string().min(32)),
    REPAYMENT_AGENT_MAX_BORROWERS_PER_RUN: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(25),
    REPAYMENT_AGENT_REQUIRE_RECONCILIATION: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    OPENAI_API_KEY: optional(z.string().min(20)),
    OPENAI_MODEL: optional(z.string().min(1).max(64)),
    OPENAI_BASE_URL: optional(z.url()),
  })
  .superRefine((environment, context) => {
    if (!environment.REPAYMENT_AGENT_ENABLED) return;
    if (environment.ARC_ESCROW_VERSION !== "3") {
      context.addIssue({
        code: "custom",
        path: ["ARC_ESCROW_VERSION"],
        message:
          "The repayment agent requires the mandate-capable escrow (ARC_ESCROW_VERSION=3).",
      });
    }
    if (!environment.ARC_REPAYMENT_AGENT_PRIVATE_KEY) {
      context.addIssue({
        code: "custom",
        path: ["ARC_REPAYMENT_AGENT_PRIVATE_KEY"],
        message:
          "ARC_REPAYMENT_AGENT_PRIVATE_KEY is required when the agent is enabled.",
      });
    } else if (
      environment.ARC_REPAYMENT_AGENT_PRIVATE_KEY.toLowerCase() ===
      environment.ARC_BORROW_AUTHORIZER_PRIVATE_KEY?.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        path: ["ARC_REPAYMENT_AGENT_PRIVATE_KEY"],
        message: "The agent key must differ from the borrow authorizer key.",
      });
    }
    if (environment.OPENAI_API_KEY && !environment.OPENAI_MODEL) {
      context.addIssue({
        code: "custom",
        path: ["OPENAI_MODEL"],
        message: "OPENAI_MODEL is required when OPENAI_API_KEY is set.",
      });
    }
  });

export type AgentEnvironment = z.infer<typeof agentEnvironmentSchema>;

export class RepaymentAgentNotConfiguredError extends Error {
  constructor(readonly issues: string[]) {
    super(`Repayment agent is not configured: ${issues.join("; ")}`);
    this.name = "RepaymentAgentNotConfiguredError";
  }
}

export function parseAgentEnvironment(
  environment: Record<string, string | undefined> = process.env,
): AgentEnvironment {
  const result = agentEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    throw new RepaymentAgentNotConfiguredError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}
