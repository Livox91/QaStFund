const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_DATABASE_NAMES = new Set([
  "employee_lending",
  "employee_lending_demo",
  "employee_lending_development",
  "employee_lending_test",
]);

export const DEMO_DATA_CONFIRMATION = "local-qastfund-demo";

export type DemoEnvironment = {
  applicationUrl: URL;
  databaseName: string;
  databaseUrl: URL;
};

export function requireSafeDemoEnvironment(
  environment: NodeJS.ProcessEnv,
): DemoEnvironment {
  if (environment.NODE_ENV === "production") {
    throw new Error("Demo tooling refuses to run with NODE_ENV=production.");
  }

  if (!environment.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the local demo.");
  }
  if (!environment.APP_URL) {
    throw new Error("APP_URL is required for the local demo.");
  }

  const databaseUrl = new URL(environment.DATABASE_URL);
  const applicationUrl = new URL(environment.APP_URL);
  const databaseName = databaseUrl.pathname.replace(/^\//, "");

  if (!LOCAL_HOSTS.has(databaseUrl.hostname)) {
    throw new Error(
      `Demo tooling refuses non-local database host ${databaseUrl.hostname}.`,
    );
  }
  if (!SAFE_DATABASE_NAMES.has(databaseName)) {
    throw new Error(
      `Demo tooling refuses database ${databaseName}; use a dedicated QastFund development database.`,
    );
  }
  if (!LOCAL_HOSTS.has(applicationUrl.hostname)) {
    throw new Error(
      `Demo tooling refuses non-local APP_URL host ${applicationUrl.hostname}.`,
    );
  }

  return { applicationUrl, databaseName, databaseUrl };
}
