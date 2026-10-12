import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/infrastructure/database/prisma";
import { transitionOperationalIncident } from "@/modules/operations/application/operational-incidents";
import { runMonitoredJob } from "@/modules/operations/application/monitored-job";
import { prismaOperationalIncidentRepository } from "@/modules/operations/infrastructure/prisma-operational-incident-repository";
import { prismaOperationalJobRepository } from "@/modules/operations/infrastructure/prisma-operational-job-repository";

const deduplicationKey = "test:operational-incident-deduplication";
const jobKey = "test-operational-job";

describe("persistent operational incidents and jobs", () => {
  afterAll(async () => {
    await prisma.operationalIncident.deleteMany({
      where: { deduplicationKey },
    });
    await prisma.operationalJobHeartbeat.deleteMany({ where: { jobKey } });
    await prisma.$disconnect();
  });

  it("deduplicates active incidents and preserves recovery history", async () => {
    await prisma.operationalIncident.deleteMany({
      where: { deduplicationKey },
    });
    const sender = vi.fn().mockResolvedValue("LOG" as const);
    const definition = {
      deduplicationKey,
      subsystem: "reconciliation",
      kind: "RECONCILIATION_STALE",
      severity: "CRITICAL" as const,
      safeReferenceId: "test-reconciliation",
      summary: "Test reconciliation incident.",
      remediation: "Use bounded replay.",
    };

    await transitionOperationalIncident({
      definition,
      active: true,
      repository: prismaOperationalIncidentRepository,
      sender,
    });
    await transitionOperationalIncident({
      definition,
      active: true,
      repository: prismaOperationalIncidentRepository,
      sender,
    });
    await transitionOperationalIncident({
      definition,
      active: false,
      repository: prismaOperationalIncidentRepository,
      sender,
    });

    const rows = await prisma.operationalIncident.findMany({
      where: { deduplicationKey },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "RECOVERED",
      occurrenceCount: 2,
      deliveryPending: false,
    });
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it("persists safe scheduler attempts, failures, and recovery", async () => {
    await prisma.operationalJobHeartbeat.deleteMany({ where: { jobKey } });
    await expect(
      runMonitoredJob({
        jobKey,
        subsystem: "erpnext",
        intervalSeconds: 300,
        safeErrorCode: "ERP_NEXT_SYNC_FAILED",
        repository: prismaOperationalJobRepository,
        run: async () => {
          throw new Error("provider detail must not persist");
        },
      }),
    ).rejects.toThrow();
    await runMonitoredJob({
      jobKey,
      subsystem: "erpnext",
      intervalSeconds: 300,
      safeErrorCode: "ERP_NEXT_SYNC_FAILED",
      repository: prismaOperationalJobRepository,
      run: async () => "ok",
    });

    await expect(
      prisma.operationalJobHeartbeat.findUniqueOrThrow({ where: { jobKey } }),
    ).resolves.toMatchObject({
      consecutiveFailures: 0,
      lastSafeErrorCode: null,
    });
  });
});
