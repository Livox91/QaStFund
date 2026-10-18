export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironment, validateTestnetEnvironment } =
      await import("@/infrastructure/config/environment");

    const environment = validateEnvironment();
    if (environment.DEPLOYMENT_ENV === "production") {
      validateTestnetEnvironment();
      const { parseAgentEnvironment } =
        await import("@/modules/repayment-agent/infrastructure/agent-environment");
      parseAgentEnvironment();
    }
  }
}
