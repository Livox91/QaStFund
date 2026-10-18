import { resolve } from "node:path";

import { config } from "dotenv";

const environmentFile = resolve(process.argv[2] ?? "deploy/.env.production");
const loaded = config({ path: environmentFile, override: true });
if (loaded.error) {
  throw new Error(
    `Unable to load production environment file: ${environmentFile}`,
  );
}

// Compose and the production image force this value at runtime. Force the same
// mode here so an omitted or misleading value in an env file cannot weaken the
// audit.
process.env.DEPLOYMENT_ENV = "production";
if (!process.env.DATABASE_URL) {
  const { POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER } = process.env;
  if (!POSTGRES_DB || !POSTGRES_PASSWORD || !POSTGRES_USER) {
    throw new Error(
      "DATABASE_URL or all of POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD are required",
    );
  }
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}@database:5432/${encodeURIComponent(POSTGRES_DB)}?schema=public`;
}

const [
  { validateEnvironment, validateTestnetEnvironment },
  { parseAgentEnvironment },
  scheduler,
] = await Promise.all([
  import("@/infrastructure/config/environment"),
  import("@/modules/repayment-agent/infrastructure/agent-environment"),
  import("../run-arc-reconciliation-scheduler.mjs"),
]);

const environment = validateEnvironment();
const arc = validateTestnetEnvironment();
const agent = parseAgentEnvironment();
scheduler.parseSchedulerConfig(process.env);

console.info(
  JSON.stringify({
    status: "valid",
    deploymentEnvironment: environment.DEPLOYMENT_ENV,
    appTransport: new URL(environment.APP_URL).protocol,
    arcNetwork: "testnet",
    arcChainId: arc.ARC_CHAIN_ID,
    reconciliationEnabled: environment.ARC_RECONCILIATION_ENABLED,
    erpNextSyncEnabled: environment.ERP_NEXT_SYNC_ENABLED,
    repaymentAgentEnabled: agent.REPAYMENT_AGENT_ENABLED,
  }),
);
