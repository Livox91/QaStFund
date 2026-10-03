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
