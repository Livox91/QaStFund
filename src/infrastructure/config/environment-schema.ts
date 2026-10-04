import { z } from "zod";

const ARC_TESTNET_CHAIN_ID = 5_042_002;
const evmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte EVM address");

function optionalString<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

function formatConfigurationError(
  feature: string,
  timing: "startup" | "feature use",
  error: z.ZodError,
): Error {
  const details = error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  return new Error(
    `Invalid environment configuration for ${feature} (required at ${timing}):\n${details}`,
  );
}

const erpNextCredentialsSchema = optionalString(z.string()).optional();

function hasValidErpNextCredentials(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return (
      !!parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length > 0
    );
  } catch {
    return false;
  }
}

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
    RATE_LIMIT_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    RATE_LIMIT_HASH_SECRET: optionalString(
      z
        .string()
        .min(32, "RATE_LIMIT_HASH_SECRET must be at least 32 characters"),
    ).optional(),
    RATE_LIMIT_TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    RATE_LIMIT_TRUSTED_PROXY_HOPS: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(1),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .max(3600)
      .default(300),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).max(1000).default(5),
    RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().min(1).max(1000).default(20),
    RATE_LIMIT_SENSITIVE_MAX: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(10),
    RATE_LIMIT_ADMIN_MAX: z.coerce.number().int().min(1).max(1000).default(20),
    RATE_LIMIT_EXPENSIVE_MAX: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(10),
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
    ARC_RECONCILIATION_STALE_AFTER_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_080)
      .default(15),
    OBSERVABILITY_FAILURE_ALERT_THRESHOLD: z.coerce
      .number()
      .int()
      .min(2)
      .max(100)
      .default(3),
    OBSERVABILITY_UNMATCHED_EVENT_ALERT_THRESHOLD: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .default(10),
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
    ERP_NEXT_SYNC_PAGE_SIZE: z.coerce
      .number()
      .int()
      .min(10)
      .max(1000)
      .default(100),
    ERP_NEXT_SYNC_MAX_PAGES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100),
    ERP_NEXT_SYNC_CRON_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32).optional(),
    ),
    ERP_NEXT_CREDENTIALS_JSON: erpNextCredentialsSchema,
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
      environment.ERP_NEXT_SYNC_ENABLED &&
      !hasValidErpNextCredentials(environment.ERP_NEXT_CREDENTIALS_JSON)
    ) {
      context.addIssue({
        code: "custom",
        path: ["ERP_NEXT_CREDENTIALS_JSON"],
        message:
          "ERP_NEXT_CREDENTIALS_JSON must be a non-empty JSON credentials object for scheduled ERPNext synchronization; it is only required when ERP_NEXT_SYNC_ENABLED=true",
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

const publicTestnetEnvironmentSchema = z.object({
  NEXT_PUBLIC_CIRCLE_CLIENT_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_CIRCLE_CLIENT_KEY is required"),
  NEXT_PUBLIC_CIRCLE_CLIENT_URL: z.url(
    "NEXT_PUBLIC_CIRCLE_CLIENT_URL must be a valid URL",
  ),
  NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS: evmAddressSchema,
});

const testnetEnvironmentSchema = publicTestnetEnvironmentSchema.extend({
  ARC_CHAIN_ID: z.coerce
    .number()
    .int("ARC_CHAIN_ID must be an integer")
    .refine((value) => value === ARC_TESTNET_CHAIN_ID, {
      message: `ARC_CHAIN_ID must be ${ARC_TESTNET_CHAIN_ID} for Arc Testnet`,
    }),
  ARC_RPC_URL: z.url("ARC_RPC_URL must be a valid URL"),
  ARC_USDC_ADDRESS: evmAddressSchema,
  ARC_BORROW_AUTHORIZER_PRIVATE_KEY: z
    .string()
    .regex(
      /^0x[0-9a-fA-F]{64}$/,
      "ARC_BORROW_AUTHORIZER_PRIVATE_KEY must be a 32-byte hex private key",
    ),
});

export type Environment = z.infer<typeof environmentSchema>;
export type PublicTestnetEnvironment = z.infer<
  typeof publicTestnetEnvironmentSchema
>;
export type TestnetEnvironment = z.infer<typeof testnetEnvironmentSchema>;

export function parseEnvironment(
  environment: Pick<NodeJS.ProcessEnv, "DATABASE_URL" | "APP_URL"> & {
    RATE_LIMIT_ENABLED?: NodeJS.ProcessEnv[string];
    RATE_LIMIT_HASH_SECRET?: NodeJS.ProcessEnv[string];
    RATE_LIMIT_TRUST_PROXY?: NodeJS.ProcessEnv[string];
    RATE_LIMIT_TRUSTED_PROXY_HOPS?: NodeJS.ProcessEnv[string];
    RATE_LIMIT_WINDOW_SECONDS?: NodeJS.ProcessEnv[string];
    RATE_LIMIT_AUTH_MAX?: NodeJS.ProcessEnv[string];
    RATE_LIMIT_PUBLIC_MAX?: NodeJS.ProcessEnv[string];
    RATE_LIMIT_SENSITIVE_MAX?: NodeJS.ProcessEnv[string];
    RATE_LIMIT_ADMIN_MAX?: NodeJS.ProcessEnv[string];
    RATE_LIMIT_EXPENSIVE_MAX?: NodeJS.ProcessEnv[string];
    LOAN_DECISION_PROVIDER?: NodeJS.ProcessEnv[string];
    EMPLOYER_ACTION_PROVIDER?: NodeJS.ProcessEnv[string];
    ERP_NEXT_ALLOW_LOCAL_HTTP?: NodeJS.ProcessEnv[string];
    ERP_NEXT_SYNC_ENABLED?: NodeJS.ProcessEnv[string];
    ERP_NEXT_SYNC_INTERVAL_MINUTES?: NodeJS.ProcessEnv[string];
    ERP_NEXT_SYNC_STALE_AFTER_MINUTES?: NodeJS.ProcessEnv[string];
    ERP_NEXT_SYNC_PAGE_SIZE?: NodeJS.ProcessEnv[string];
    ERP_NEXT_SYNC_MAX_PAGES?: NodeJS.ProcessEnv[string];
    ERP_NEXT_SYNC_CRON_SECRET?: NodeJS.ProcessEnv[string];
    ERP_NEXT_CREDENTIALS_JSON?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_ENABLED?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_RPC_URL?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_START_BLOCK?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_CONFIRMATIONS?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_BLOCK_RANGE?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_REORG_WINDOW?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_MAX_RANGES?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_RPC_RETRIES?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_STALE_AFTER_MINUTES?: NodeJS.ProcessEnv[string];
    OBSERVABILITY_FAILURE_ALERT_THRESHOLD?: NodeJS.ProcessEnv[string];
    OBSERVABILITY_UNMATCHED_EVENT_ALERT_THRESHOLD?: NodeJS.ProcessEnv[string];
    ARC_RECONCILIATION_CRON_SECRET?: NodeJS.ProcessEnv[string];
  },
): Environment {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw formatConfigurationError(
      "local application startup",
      "startup",
      result.error,
    );
  }

  return result.data;
}

export function parsePublicTestnetEnvironment(
  environment: Record<string, string | undefined>,
): PublicTestnetEnvironment {
  const result = publicTestnetEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    throw formatConfigurationError(
      "Arc testnet browser wallet functionality",
      "feature use",
      result.error,
    );
  }
  return result.data;
}

export function parseTestnetEnvironment(
  environment: Record<string, string | undefined>,
): TestnetEnvironment {
  const result = testnetEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    throw formatConfigurationError(
      "Arc testnet blockchain functionality",
      "feature use",
      result.error,
    );
  }
  return result.data;
}
