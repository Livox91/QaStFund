import { z } from "zod";

const environmentSchema = z.object({
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
  >,
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
  });
  return cachedEnvironment;
}
