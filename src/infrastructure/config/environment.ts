import { z } from "zod";

const environmentSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine(
        (value) =>
          value.startsWith("postgresql://") || value.startsWith("postgres://"),
        "DATABASE_URL must be a PostgreSQL connection URL",
      ),
    APP_URL: z.url("APP_URL must be a valid URL"),
    NEXT_PUBLIC_CIRCLE_CLIENT_KEY: z
      .string()
      .min(1, "NEXT_PUBLIC_CIRCLE_CLIENT_KEY is required"),
    NEXT_PUBLIC_CIRCLE_CLIENT_URL: z.url(
      "NEXT_PUBLIC_CIRCLE_CLIENT_URL must be a valid URL",
    ),
    ARC_BORROW_AUTHORIZER_PRIVATE_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .regex(
          /^0x[0-9a-fA-F]{64}$/,
          "ARC_BORROW_AUTHORIZER_PRIVATE_KEY must be a 32-byte hex private key",
        )
        .optional(),
    ),
    ARC_RECONCILIATION_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ARC_RECONCILIATION_RPC_URL: z
      .url()
      .default("https://rpc.testnet.arc.network"),
    ARC_RECONCILIATION_START_BLOCK: z
      .string()
      .regex(/^\d+$/)
      .default("0")
      .transform((value) => BigInt(value)),
    ARC_RECONCILIATION_CONFIRMATIONS: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(5),
    ARC_RECONCILIATION_BLOCK_RANGE: z.coerce
      .number()
      .int()
      .min(10)
      .max(10_000)
      .default(1000),
    ARC_RECONCILIATION_REORG_WINDOW: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(20),
    ARC_RECONCILIATION_MAX_RANGES: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10),
    ARC_RECONCILIATION_RPC_RETRIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3),
    ARC_RECONCILIATION_CRON_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32).optional(),
    ),
    LOAN_DECISION_PROVIDER: z.enum(["rules", "model"]).default("rules"),
    EMPLOYER_ACTION_PROVIDER: z.enum(["mock"]).default("mock"),
    ERP_NEXT_ALLOW_LOCAL_HTTP: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ERP_NEXT_SYNC_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ERP_NEXT_SYNC_INTERVAL_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(10_080)
      .default(1440),
    ERP_NEXT_SYNC_STALE_AFTER_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(1440)
      .default(30),
    ERP_NEXT_SYNC_CRON_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32).optional(),
    ),
  })
  .superRefine((environment, context) => {
    if (
      environment.ERP_NEXT_SYNC_ENABLED &&
      !environment.ERP_NEXT_SYNC_CRON_SECRET
    ) {
      context.addIssue({
        code: "custom",
        path: ["ERP_NEXT_SYNC_CRON_SECRET"],
        message:
          "ERP_NEXT_SYNC_CRON_SECRET is required when scheduling is enabled",
      });
    }
    if (
      environment.ARC_RECONCILIATION_ENABLED &&
      !environment.ARC_RECONCILIATION_CRON_SECRET
    ) {
      context.addIssue({
        code: "custom",
        path: ["ARC_RECONCILIATION_CRON_SECRET"],
        message:
          "ARC_RECONCILIATION_CRON_SECRET is required when reconciliation is enabled",
      });
    }
    if (
      environment.ARC_RECONCILIATION_BLOCK_RANGE <=
      environment.ARC_RECONCILIATION_REORG_WINDOW
    ) {
      context.addIssue({
        code: "custom",
        path: ["ARC_RECONCILIATION_BLOCK_RANGE"],
        message: "block range must be greater than the reorganization window",
      });
    }
    if (
      environment.ARC_RECONCILIATION_REORG_WINDOW <
      environment.ARC_RECONCILIATION_CONFIRMATIONS
    ) {
      context.addIssue({
        code: "custom",
        path: ["ARC_RECONCILIATION_REORG_WINDOW"],
        message:
          "reorganization window must be at least the confirmation depth",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

let cachedEnvironment: Environment | undefined;

export function parseEnvironment(
  environment: Pick<
    NodeJS.ProcessEnv,
    | "DATABASE_URL"
    | "APP_URL"
    | "NEXT_PUBLIC_CIRCLE_CLIENT_KEY"
    | "NEXT_PUBLIC_CIRCLE_CLIENT_URL"
  > & {
    LOAN_DECISION_PROVIDER?: NodeJS.ProcessEnv[string];
    EMPLOYER_ACTION_PROVIDER?: NodeJS.ProcessEnv[string];
    ERP_NEXT_ALLOW_LOCAL_HTTP?: NodeJS.ProcessEnv[string];
    ERP_NEXT_SYNC_ENABLED?: NodeJS.ProcessEnv[string];
    ERP_NEXT_SYNC_INTERVAL_MINUTES?: NodeJS.ProcessEnv[string];
    ERP_NEXT_SYNC_STALE_AFTER_MINUTES?: NodeJS.ProcessEnv[string];
    ERP_NEXT_SYNC_CRON_SECRET?: NodeJS.ProcessEnv[string];
    ARC_BORROW_AUTHORIZER_PRIVATE_KEY?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_ENABLED?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_RPC_URL?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_START_BLOCK?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_CONFIRMATIONS?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_BLOCK_RANGE?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_REORG_WINDOW?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_MAX_RANGES?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_RPC_RETRIES?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_CRON_SECRET?: NodeJS.ProcessEnv[string];
  },
): Environment {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}

export function validateEnvironment(): Environment {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }

  cachedEnvironment = parseEnvironment({
    DATABASE_URL: process.env.DATABASE_URL,
    APP_URL: process.env.APP_URL,
    NEXT_PUBLIC_CIRCLE_CLIENT_KEY: process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY,
    NEXT_PUBLIC_CIRCLE_CLIENT_URL: process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL,
    ARC_BORROW_AUTHORIZER_PRIVATE_KEY:
      process.env.ARC_BORROW_AUTHORIZER_PRIVATE_KEY,
    ARC_RECONCILIATION_ENABLED: process.env.ARC_RECONCILIATION_ENABLED,
    ARC_RECONCILIATION_RPC_URL: process.env.ARC_RECONCILIATION_RPC_URL,
    ARC_RECONCILIATION_START_BLOCK: process.env.ARC_RECONCILIATION_START_BLOCK,
    ARC_RECONCILIATION_CONFIRMATIONS:
      process.env.ARC_RECONCILIATION_CONFIRMATIONS,
    ARC_RECONCILIATION_BLOCK_RANGE: process.env.ARC_RECONCILIATION_BLOCK_RANGE,
    ARC_RECONCILIATION_REORG_WINDOW:
      process.env.ARC_RECONCILIATION_REORG_WINDOW,
    ARC_RECONCILIATION_MAX_RANGES: process.env.ARC_RECONCILIATION_MAX_RANGES,
    ARC_RECONCILIATION_RPC_RETRIES: process.env.ARC_RECONCILIATION_RPC_RETRIES,
    ARC_RECONCILIATION_CRON_SECRET: process.env.ARC_RECONCILIATION_CRON_SECRET,
    LOAN_DECISION_PROVIDER: process.env.LOAN_DECISION_PROVIDER,
    EMPLOYER_ACTION_PROVIDER: process.env.EMPLOYER_ACTION_PROVIDER,
    ERP_NEXT_ALLOW_LOCAL_HTTP: process.env.ERP_NEXT_ALLOW_LOCAL_HTTP,
    ERP_NEXT_SYNC_ENABLED: process.env.ERP_NEXT_SYNC_ENABLED,
    ERP_NEXT_SYNC_INTERVAL_MINUTES: process.env.ERP_NEXT_SYNC_INTERVAL_MINUTES,
    ERP_NEXT_SYNC_STALE_AFTER_MINUTES:
      process.env.ERP_NEXT_SYNC_STALE_AFTER_MINUTES,
    ERP_NEXT_SYNC_CRON_SECRET: process.env.ERP_NEXT_SYNC_CRON_SECRET,
  });
  return cachedEnvironment;
}
