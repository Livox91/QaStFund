import { logger } from "@/infrastructure/logging/logger";

export type OperationalDependency =
  | "arc_rpc"
  | "circle"
  | "database"
  | "email"
  | "erpnext"
  | "reconciliation"
  | "transaction_confirmation";

type FailureState = {
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
};

type ReconciliationState = {
  latestObservedBlock: string | null;
  lastSuccessfulAt: string | null;
  lastFailureAt: string | null;
};

type OperationalStore = {
  activeThresholdAlerts: Record<string, boolean>;
  counters: Record<string, number>;
  failures: Partial<Record<OperationalDependency, FailureState>>;
  reconciliation: ReconciliationState;
  timers: Record<string, { count: number; totalMs: number; maxMs: number }>;
};

const storeKey = Symbol.for("employee-p2p-lending.operational-signals");

function createStore(): OperationalStore {
  return {
    activeThresholdAlerts: {},
    counters: {},
    failures: {},
    reconciliation: {
      latestObservedBlock: null,
      lastSuccessfulAt: null,
      lastFailureAt: null,
    },
    timers: {},
  };
}

const globals = globalThis as typeof globalThis & {
  [storeKey]?: OperationalStore;
};
const store = (globals[storeKey] ??= createStore());

export function operationalFailureAlertThreshold(): number {
  const parsed = Number(process.env.OBSERVABILITY_FAILURE_ALERT_THRESHOLD ?? 3);
  return Number.isInteger(parsed) && parsed >= 2 && parsed <= 100 ? parsed : 3;
}

export function incrementOperationalCounter(name: string, amount = 1): void {
  store.counters[name] = (store.counters[name] ?? 0) + amount;
}

export function evaluateOperationalThreshold(
  alert: string,
  current: number,
  threshold: number,
  context?: Record<string, unknown>,
): boolean {
  if (current < threshold) {
    store.activeThresholdAlerts[alert] = false;
    return false;
  }
  if (store.activeThresholdAlerts[alert]) return true;
  store.activeThresholdAlerts[alert] = true;
  logger.warn("Operational alert triggered", {
    alert,
    current,
    threshold,
    ...context,
  });
  return true;
}

export function observeOperationalTimer(
  name: string,
  durationMs: number,
): void {
  const current = store.timers[name] ?? { count: 0, totalMs: 0, maxMs: 0 };
  store.timers[name] = {
    count: current.count + 1,
    totalMs: current.totalMs + Math.max(0, durationMs),
    maxMs: Math.max(current.maxMs, durationMs),
  };
}

export function recordOperationalSuccess(
  dependency: OperationalDependency,
  occurredAt = new Date(),
): void {
  const current = store.failures[dependency];
  store.failures[dependency] = {
    consecutiveFailures: 0,
    lastFailureAt: current?.lastFailureAt ?? null,
    lastSuccessAt: occurredAt.toISOString(),
  };
}

export function recordOperationalFailure(
  dependency: OperationalDependency,
  options: {
    alertThreshold: number;
    context?: Record<string, unknown>;
    occurredAt?: Date;
  },
): FailureState {
  const occurredAt = options.occurredAt ?? new Date();
  const current = store.failures[dependency];
  const next: FailureState = {
    consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
    lastFailureAt: occurredAt.toISOString(),
    lastSuccessAt: current?.lastSuccessAt ?? null,
  };
  store.failures[dependency] = next;
  incrementOperationalCounter(`${dependency}_failures_total`);

  // Emit once when a failure streak becomes actionable. A recovery resets it.
  if (next.consecutiveFailures === options.alertThreshold) {
    logger.warn("Operational alert triggered", {
      alert: `${dependency}_repeated_failures`,
      dependency,
      consecutiveFailures: next.consecutiveFailures,
      threshold: options.alertThreshold,
      ...options.context,
    });
  }
  return { ...next };
}

export function recordReconciliationSuccess(input: {
  latestObservedBlock: bigint;
  occurredAt?: Date;
}): void {
  const occurredAt = input.occurredAt ?? new Date();
  store.reconciliation.latestObservedBlock =
    input.latestObservedBlock.toString();
  store.reconciliation.lastSuccessfulAt = occurredAt.toISOString();
  recordOperationalSuccess("arc_rpc", occurredAt);
  recordOperationalSuccess("reconciliation", occurredAt);
}

export function recordReconciliationFailure(occurredAt = new Date()): void {
  store.reconciliation.lastFailureAt = occurredAt.toISOString();
}

export function logTransactionLifecycle(
  eventType:
    | "acceptance_confirmed"
    | "acceptance_reverted"
    | "acceptance_submitted"
    | "missed_confirmation_recovered"
    | "offer_confirmed"
    | "offer_reverted"
    | "offer_submitted"
    | "repayment_confirmed"
    | "repayment_reverted"
    | "repayment_submitted"
    | "transaction_pending"
    | "transaction_unknown"
    | "unmatched_blockchain_event",
  context: {
    operationId: string;
    transactionHash?: string;
    chainId: number;
    contractAddress: string;
    latencyMs?: number;
  },
): void {
  incrementOperationalCounter(`transaction_${eventType}_total`);
  if (context.latencyMs !== undefined) {
    observeOperationalTimer(
      "transaction_confirmation_latency_ms",
      context.latencyMs,
    );
  }
  logger.info("Transaction lifecycle transition", { eventType, ...context });
}

export function getOperationalSnapshot() {
  return {
    counters: { ...store.counters },
    failures: Object.fromEntries(
      Object.entries(store.failures).map(([key, value]) => [
        key,
        value ? { ...value } : value,
      ]),
    ),
    reconciliation: { ...store.reconciliation },
    timers: Object.fromEntries(
      Object.entries(store.timers).map(([key, value]) => [key, { ...value }]),
    ),
  };
}

export function resetOperationalSignalsForTests(): void {
  store.activeThresholdAlerts = {};
  store.counters = {};
  store.failures = {};
  store.reconciliation = {
    latestObservedBlock: null,
    lastSuccessfulAt: null,
    lastFailureAt: null,
  };
  store.timers = {};
}
