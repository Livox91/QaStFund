import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOperationalIncidentSender,
  transitionOperationalIncident,
  type OperationalIncidentEvent,
  type OperationalIncidentRepository,
} from "@/modules/operations/application/operational-incidents";
import { deriveOperationalIncidentChecks } from "@/modules/operations/application/evaluate-operational-incidents";
import { buildDependencyHealth } from "@/server/application/health/build-dependency-health";

class MemoryIncidentRepository implements OperationalIncidentRepository {
  id = "10000000-0000-4000-8000-000000000001";
  status: OperationalIncidentEvent | "NONE" = "NONE";
  pending = false;
  lastAttemptAt: Date | null = null;
  failed = false;

  async prepareTransition(input: {
    active: boolean;
    now: Date;
    retryAfterMs: number;
  }) {
    if (!input.active) {
      if (this.status !== "ACTIVE") {
        return { incidentId: this.id, deliver: false, event: null };
      }
      this.status = "RECOVERED";
      this.pending = true;
      this.lastAttemptAt = input.now;
      return {
        incidentId: this.id,
        deliver: true,
        event: "RECOVERED" as const,
      };
    }
    const changed = this.status !== "ACTIVE";
    const retryDue =
      this.pending &&
      (!this.lastAttemptAt ||
        input.now.getTime() - this.lastAttemptAt.getTime() >=
          input.retryAfterMs);
    const deliver = changed || retryDue;
    this.status = "ACTIVE";
    if (deliver) {
      this.pending = true;
      this.lastAttemptAt = input.now;
    }
    return {
      incidentId: this.id,
      deliver,
      event: deliver ? ("ACTIVE" as const) : null,
    };
  }

  async markDelivered() {
    this.pending = false;
  }

  async markDeliveryFailed() {
    this.pending = true;
    this.failed = true;
  }
}

const definition = {
  deduplicationKey: "arc:reconciliation-stale",
  subsystem: "reconciliation",
  kind: "RECONCILIATION_STALE",
  severity: "CRITICAL" as const,
  safeReferenceId: "arc-reconciliation",
  summary: "Reconciliation is stale.",
  remediation: "Run bounded catch-up from the persisted cursor.",
};

describe("operational incident transitions", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("deduplicates an active incident and sends one recovery", async () => {
    const repository = new MemoryIncidentRepository();
    const sender = vi.fn().mockResolvedValue("WEBHOOK" as const);

    await transitionOperationalIncident({
      definition,
      active: true,
      repository,
      sender,
    });
    await transitionOperationalIncident({
      definition,
      active: true,
      repository,
      sender,
    });
    await transitionOperationalIncident({
      definition,
      active: false,
      repository,
      sender,
    });

    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[0][0]).toMatchObject({
      event: "ACTIVE",
      severity: "CRITICAL",
      subsystem: "reconciliation",
      referenceId: "arc-reconciliation",
      remediation: definition.remediation,
    });
    expect(sender.mock.calls[1][0]).toMatchObject({ event: "RECOVERED" });
  });

  it("persists delivery failure and retries only after the cooldown", async () => {
    const repository = new MemoryIncidentRepository();
    const sender = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = new Date("2026-10-12T12:00:00.000Z");

    for (const offset of [0, 60_000, 300_000]) {
      await transitionOperationalIncident({
        definition,
        active: true,
        repository,
        sender,
        now: new Date(first.getTime() + offset),
        retryAfterMs: 300_000,
      });
    }

    expect(sender).toHaveBeenCalledTimes(2);
    expect(repository.failed).toBe(true);
  });

  it("keeps webhook credentials out of the alert payload", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const sender = createOperationalIncidentSender({
      webhookUrl: "https://alerts.example.test/incidents",
      bearerToken: "alert-delivery-secret",
      fetchImplementation: request,
    });
    await sender({
      incidentId: "10000000-0000-4000-8000-000000000001",
      event: "ACTIVE",
      severity: "CRITICAL",
      eventTime: "2026-10-12T12:00:00.000Z",
      subsystem: "reconciliation",
      kind: "RECONCILIATION_STALE",
      referenceId: "arc-reconciliation",
      summary: definition.summary,
      remediation: definition.remediation,
      metadata: {},
    });

    expect(request.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer alert-delivery-secret",
    );
    expect(request.mock.calls[0][1].body).not.toContain(
      "alert-delivery-secret",
    );
  });

  it("derives actionable alerts for every unhealthy operational subsystem", () => {
    const report = buildDependencyHealth({
      now: new Date("2026-10-12T12:10:00.000Z"),
      reconciliationEnabled: true,
      reconciliationStaleAfterMs: 15 * 60_000,
      reconciliationState: {
        cursor: {
          nextBlock: 100n,
          finalizedThrough: 99n,
          updatedAt: new Date("2026-10-12T12:09:00.000Z"),
        },
        unmatchedEvents: 10,
        conflictingEvents: 1,
      },
      latestObservedBlock: "99",
      failures: {
        reconciliation: {
          consecutiveFailures: 3,
          lastFailureAt: "2026-10-12T12:09:00.000Z",
          lastSuccessAt: "2026-10-12T12:08:00.000Z",
        },
      },
      arc: { status: "healthy", contractConfigured: true },
      circleConfigured: true,
      erpEnabled: true,
      erpState: {
        configuredIntegrations: 1,
        connectedIntegrations: 1,
        incompleteIntegrations: 1,
        staleIntegrations: 1,
        unresolvedEmployeeRecords: 2,
      },
      transactionState: {
        pendingSubmission: 0,
        pendingConfirmation: 1,
        pendingReconciliation: 1,
        ambiguousOutcomes: 1,
        failedOperations: 2,
        failedRepayments: 3,
        overdueRepayments: 1,
      },
      operationalJobs: [
        {
          jobKey: "erpnext-sync",
          subsystem: "erpnext",
          intervalSeconds: 900,
          lastAttemptedAt: new Date("2026-10-12T11:00:00.000Z"),
          lastSucceededAt: new Date("2026-10-12T11:00:00.000Z"),
          lastFailedAt: null,
          nextExpectedAt: new Date("2026-10-12T11:15:00.000Z"),
          consecutiveFailures: 0,
          lastSafeErrorCode: null,
        },
      ],
      schedulerGraceMs: 60_000,
      incidentDeliveryState: {
        activeIncidents: 1,
        pendingDeliveries: 1,
        failedDeliveries: 1,
      },
      metrics: {},
      timers: {},
    });
    const activeKinds = deriveOperationalIncidentChecks({
      report,
      failureThreshold: 3,
      unmatchedEventThreshold: 10,
    })
      .filter((check) => check.active)
      .map((check) => check.definition.kind);

    expect(activeKinds).toEqual(
      expect.arrayContaining([
        "ERP_NEXT_SYNC_STALE_OR_FAILED",
        "RECONCILIATION_REPEATED_FAILURE",
        "ONCHAIN_DATABASE_DISCREPANCY",
        "AMBIGUOUS_TRANSACTION_OUTCOME",
        "FAILED_TRANSACTION_RECEIPT",
        "REPEATED_REPAYMENT_PROCESSING_FAILURE",
        "ALERT_DELIVERY_FAILURE",
        "SCHEDULER_EXECUTION_MISSED",
      ]),
    );
  });
});
