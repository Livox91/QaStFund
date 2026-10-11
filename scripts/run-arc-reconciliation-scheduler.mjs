const DEFAULT_ENDPOINT = "http://app:3000/api/internal/arc-reconciliation";
const DEFAULT_ERPNEXT_ENDPOINT = "http://app:3000/api/internal/erpnext-sync";

export function parseSchedulerConfig(environment = process.env) {
  const secret = environment.ARC_RECONCILIATION_CRON_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "ARC_RECONCILIATION_CRON_SECRET must contain at least 32 characters",
    );
  }
  const intervalSeconds = Number(
    environment.ARC_RECONCILIATION_INTERVAL_SECONDS ?? 60,
  );
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < 10 ||
    intervalSeconds > 3600
  ) {
    throw new Error(
      "ARC_RECONCILIATION_INTERVAL_SECONDS must be an integer from 10 to 3600",
    );
  }
  const failureThreshold = Number(
    environment.OBSERVABILITY_FAILURE_ALERT_THRESHOLD ?? 3,
  );
  if (
    !Number.isInteger(failureThreshold) ||
    failureThreshold < 2 ||
    failureThreshold > 100
  ) {
    throw new Error(
      "OBSERVABILITY_FAILURE_ALERT_THRESHOLD must be an integer from 2 to 100",
    );
  }
  const erpNextEnabled = environment.ERP_NEXT_SYNC_ENABLED === "true";
  const erpNextSecret = environment.ERP_NEXT_SYNC_CRON_SECRET;
  if (erpNextEnabled && (!erpNextSecret || erpNextSecret.length < 32)) {
    throw new Error(
      "ERP_NEXT_SYNC_CRON_SECRET must contain at least 32 characters when ERPNext scheduling is enabled",
    );
  }
  const erpNextIntervalMinutes = Number(
    environment.ERP_NEXT_SYNC_INTERVAL_MINUTES ?? 1440,
  );
  if (
    erpNextEnabled &&
    (!Number.isInteger(erpNextIntervalMinutes) ||
      erpNextIntervalMinutes < 5 ||
      erpNextIntervalMinutes > 10_080)
  ) {
    throw new Error(
      "ERP_NEXT_SYNC_INTERVAL_MINUTES must be an integer from 5 to 10080",
    );
  }
  return {
    secret,
    intervalMs: intervalSeconds * 1_000,
    failureThreshold,
    endpoint: environment.ARC_RECONCILIATION_SCHEDULER_URL ?? DEFAULT_ENDPOINT,
    webhookUrl: environment.OPERATIONAL_ALERT_WEBHOOK_URL || undefined,
    webhookToken:
      environment.OPERATIONAL_ALERT_WEBHOOK_BEARER_TOKEN || undefined,
    erpNext: erpNextEnabled
      ? {
          secret: erpNextSecret,
          intervalMs: erpNextIntervalMinutes * 60_000,
          endpoint:
            environment.ERP_NEXT_SYNC_SCHEDULER_URL ?? DEFAULT_ERPNEXT_ENDPOINT,
        }
      : null,
  };
}

async function deliverSchedulerAlert(
  config,
  payload,
  fetchImplementation,
  alert = "arc_reconciliation_scheduler",
) {
  if (!config.webhookUrl) {
    console.warn(
      JSON.stringify({
        message: "Operational alert triggered",
        alert,
        ...payload,
      }),
    );
    return "LOG";
  }
  const response = await fetchImplementation(config.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.webhookToken
        ? { Authorization: `Bearer ${config.webhookToken}` }
        : {}),
    },
    body: JSON.stringify({
      alert,
      occurredAt: new Date().toISOString(),
      ...payload,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Alert webhook returned ${response.status}`);
  }
  return "WEBHOOK";
}

export async function runErpNextSchedulerIteration(
  config,
  state,
  fetchImplementation = fetch,
) {
  if (!config.erpNext) return;
  try {
    const response = await fetchImplementation(config.erpNext.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.erpNext.secret}` },
      signal: AbortSignal.timeout(
        Math.max(30_000, Math.min(config.erpNext.intervalMs, 300_000)),
      ),
    });
    if (!response.ok) {
      throw new Error(`ERPNext sync endpoint returned ${response.status}`);
    }
    const result = await response.json();
    console.info(
      JSON.stringify({
        message: "ERPNext scheduler response received",
        considered: result.considered,
        succeeded: result.succeeded,
        partial: result.partial,
        failed: result.failed,
        skipped: result.skipped,
      }),
    );
    if ((result.partial ?? 0) > 0 || (result.failed ?? 0) > 0) {
      throw new Error(
        `ERPNext sync was incomplete (partial=${result.partial ?? 0}, failed=${result.failed ?? 0})`,
      );
    }
    if (state.alertActive) {
      await deliverSchedulerAlert(
        config,
        {
          event: "RECOVERED",
          consecutiveFailures: 0,
          detail: "Scheduled ERPNext synchronization recovered.",
        },
        fetchImplementation,
        "erpnext_scheduler",
      );
    }
    state.consecutiveFailures = 0;
    state.alertActive = false;
  } catch (error) {
    state.consecutiveFailures += 1;
    console.error(
      JSON.stringify({
        message: "ERPNext scheduler run failed",
        consecutiveFailures: state.consecutiveFailures,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    if (
      !state.alertActive &&
      state.consecutiveFailures >= config.failureThreshold
    ) {
      try {
        await deliverSchedulerAlert(
          config,
          {
            event: "ACTIVE",
            consecutiveFailures: state.consecutiveFailures,
            detail:
              "Scheduled ERPNext synchronization is unavailable or incomplete.",
          },
          fetchImplementation,
          "erpnext_scheduler",
        );
        state.alertActive = true;
      } catch (alertError) {
        console.error(
          JSON.stringify({
            message: "ERPNext scheduler alert delivery failed",
            error:
              alertError instanceof Error
                ? alertError.message
                : "Unknown error",
          }),
        );
      }
    }
  }
}

export async function runSchedulerIteration(
  config,
  state,
  fetchImplementation = fetch,
) {
  try {
    const response = await fetchImplementation(config.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.secret}` },
      signal: AbortSignal.timeout(Math.max(30_000, config.intervalMs)),
    });
    if (!response.ok) {
      throw new Error(`Reconciliation endpoint returned ${response.status}`);
    }
    const result = await response.json();
    console.info(
      JSON.stringify({
        message: "Arc reconciliation scheduler run completed",
        status: result.status,
        scannedRanges: result.scannedRanges,
        remainingBacklogBlocks: result.remainingBacklogBlocks ?? null,
        caughtUp: result.caughtUp ?? null,
      }),
    );
    if (state.alertActive) {
      await deliverSchedulerAlert(
        config,
        {
          event: "RECOVERED",
          consecutiveFailures: 0,
          detail: "The Arc reconciliation scheduler endpoint recovered.",
        },
        fetchImplementation,
      );
    }
    state.consecutiveFailures = 0;
    state.alertActive = false;
  } catch (error) {
    state.consecutiveFailures += 1;
    console.error(
      JSON.stringify({
        message: "Arc reconciliation scheduler run failed",
        consecutiveFailures: state.consecutiveFailures,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    if (
      !state.alertActive &&
      state.consecutiveFailures >= config.failureThreshold
    ) {
      try {
        await deliverSchedulerAlert(
          config,
          {
            event: "ACTIVE",
            consecutiveFailures: state.consecutiveFailures,
            detail:
              "The scheduler cannot reach a successful Arc reconciliation endpoint.",
          },
          fetchImplementation,
        );
        state.alertActive = true;
      } catch (alertError) {
        console.error(
          JSON.stringify({
            message: "Arc scheduler alert delivery failed",
            error:
              alertError instanceof Error
                ? alertError.message
                : "Unknown error",
          }),
        );
      }
    }
  }
}

export async function runScheduler(environment = process.env) {
  const config = parseSchedulerConfig(environment);
  const state = { consecutiveFailures: 0, alertActive: false };
  const erpNextState = { consecutiveFailures: 0, alertActive: false };
  let nextErpNextRunAt = 0;
  let stopping = false;
  process.once("SIGTERM", () => {
    stopping = true;
  });
  process.once("SIGINT", () => {
    stopping = true;
  });
  do {
    await runSchedulerIteration(config, state);
    if (config.erpNext && Date.now() >= nextErpNextRunAt) {
      await runErpNextSchedulerIteration(config, erpNextState);
      nextErpNextRunAt = Date.now() + config.erpNext.intervalMs;
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
  } while (!stopping);
}

if (process.argv[1]?.endsWith("run-arc-reconciliation-scheduler.mjs")) {
  runScheduler().catch((error) => {
    console.error(
      JSON.stringify({
        message: "Arc reconciliation scheduler stopped",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    process.exitCode = 1;
  });
}
