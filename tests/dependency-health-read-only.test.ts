import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordOperationalFailure: vi.fn(),
  recordOperationalSuccess: vi.fn(),
  evaluateOperationalThreshold: vi.fn(),
  evaluateOperationalIncidents: vi.fn(),
  createOperationalIncidentSender: vi.fn(),
}));

vi.mock("@/infrastructure/config/environment", () => ({
  validateEnvironment: () => ({
    ARC_RECONCILIATION_RPC_URL: "https://rpc.example.test",
    ARC_RECONCILIATION_ENABLED: true,
    ARC_RECONCILIATION_STALE_AFTER_MINUTES: 30,
    ARC_RECONCILIATION_CONFIRMATIONS: 5,
    ARC_RECONCILIATION_BLOCK_RANGE: 100,
    ARC_RECONCILIATION_MAX_RANGES: 5,
    ARC_RECONCILIATION_INTERVAL_SECONDS: 60,
    ERP_NEXT_SYNC_ENABLED: false,
    ERP_NEXT_SYNC_STALE_AFTER_MINUTES: 30,
    ERP_NEXT_SYNC_INTERVAL_MINUTES: 60,
    OBSERVABILITY_FAILURE_ALERT_THRESHOLD: 3,
    OBSERVABILITY_TRANSACTION_STALE_AFTER_MINUTES: 15,
    OBSERVABILITY_SCHEDULER_GRACE_SECONDS: 60,
    OBSERVABILITY_UNMATCHED_EVENT_ALERT_THRESHOLD: 1,
    OBSERVABILITY_ALERT_RETRY_MINUTES: 5,
  }),
}));

vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => ({
    getChainId: async () => 5_042_002,
    getCode: async () => "0x01",
    getBlockNumber: async () => 100n,
  }),
  http: vi.fn(),
}));

vi.mock(
  "@/infrastructure/database/repositories/prisma-operational-health-repository",
  () => ({
    prismaOperationalHealthRepository: {
      getReconciliationState: async () => ({
        cursor: null,
        unmatchedEvents: 0,
      }),
      getErpNextState: vi.fn(),
      getTransactionState: async () => null,
      getOperationalJobs: async () => [],
      getIncidentDeliveryState: async () => null,
    },
  }),
);

vi.mock("@/infrastructure/observability/operational-signals", () => ({
  getOperationalSnapshot: () => ({
    counters: {},
    failures: {},
    reconciliation: {},
    timers: {},
  }),
  evaluateOperationalThreshold: mocks.evaluateOperationalThreshold,
  recordOperationalFailure: mocks.recordOperationalFailure,
  recordOperationalSuccess: mocks.recordOperationalSuccess,
}));

vi.mock("@/integrations/arc/employee-lending-escrow", () => ({
  getConfiguredEscrowAddress: () =>
    "0x46c4a0a877e6967542078A580468b80195c466cC",
}));

vi.mock(
  "@/modules/operations/application/evaluate-operational-incidents",
  () => ({ evaluateOperationalIncidents: mocks.evaluateOperationalIncidents }),
);

vi.mock("@/modules/operations/application/operational-incidents", () => ({
  createOperationalIncidentSender: mocks.createOperationalIncidentSender,
}));

vi.mock("@/server/application/health/build-dependency-health", () => ({
  buildDependencyHealth: () => ({
    dependencies: { reconciliation: { status: "healthy" } },
  }),
}));

import { getConfiguredDependencyHealth } from "@/server/application/health/get-configured-dependency-health";

describe("configured dependency health read-only mode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not record signals, incidents, or alert deliveries", async () => {
    await getConfiguredDependencyHealth({ mode: "read-only" });

    expect(mocks.recordOperationalFailure).not.toHaveBeenCalled();
    expect(mocks.recordOperationalSuccess).not.toHaveBeenCalled();
    expect(mocks.evaluateOperationalThreshold).not.toHaveBeenCalled();
    expect(mocks.evaluateOperationalIncidents).not.toHaveBeenCalled();
    expect(mocks.createOperationalIncidentSender).not.toHaveBeenCalled();
  });

  it("preserves recording behavior by default", async () => {
    await getConfiguredDependencyHealth();

    expect(mocks.recordOperationalSuccess).toHaveBeenCalledWith(
      "arc_rpc",
      expect.any(Date),
    );
    expect(mocks.evaluateOperationalThreshold).toHaveBeenCalledOnce();
    expect(mocks.evaluateOperationalIncidents).toHaveBeenCalledOnce();
    expect(mocks.createOperationalIncidentSender).toHaveBeenCalledOnce();
  });
});
