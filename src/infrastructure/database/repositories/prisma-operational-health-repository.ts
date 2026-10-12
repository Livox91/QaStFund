import "server-only";

import { prisma } from "@/infrastructure/database/prisma";

export const prismaOperationalHealthRepository = {
  async getReconciliationState(chainId: number, contractAddress: string) {
    const normalized = contractAddress.toLowerCase();
    const [cursor, unmatchedEvents, conflictingEvents] = await Promise.all([
      prisma.blockchainReconciliationCursor.findUnique({
        where: {
          chainId_contractAddress: { chainId, contractAddress: normalized },
        },
        select: {
          nextBlock: true,
          finalizedThrough: true,
          updatedAt: true,
          latestObservedBlock: true,
          lastSuccessfulAt: true,
          lastFailureAt: true,
          consecutiveFailures: true,
          alertState: true,
          alertChangedAt: true,
          alertDeliveryPending: true,
          lastAlertAttemptAt: true,
          lastAlertDeliveredAt: true,
          lastAlertFailedAt: true,
        },
      }),
      prisma.blockchainEvent.count({
        where: { chainId, contractAddress: normalized, status: "UNMATCHED" },
      }),
      prisma.blockchainEvent.count({
        where: { chainId, contractAddress: normalized, status: "CONFLICT" },
      }),
    ]);
    return { cursor, unmatchedEvents, conflictingEvents };
  },

  async getErpNextState(staleBefore: Date) {
    const enabled = { organization: { erpNextEnabled: true } } as const;
    const [
      configuredIntegrations,
      incompleteIntegrations,
      staleIntegrations,
      connectedIntegrations,
      unresolvedEmployeeRecords,
      latestRun,
      lastSuccessful,
    ] = await Promise.all([
      prisma.employeeDirectoryIntegration.count({ where: enabled }),
      prisma.employeeDirectoryIntegration.count({
        where: {
          ...enabled,
          OR: [
            { lastSyncStatus: null },
            { lastSyncStatus: { not: "SUCCESS" } },
          ],
        },
      }),
      prisma.employeeDirectoryIntegration.count({
        where: {
          ...enabled,
          OR: [
            { lastSuccessfulSyncAt: null },
            { lastSuccessfulSyncAt: { lt: staleBefore } },
          ],
        },
      }),
      prisma.employeeDirectoryIntegration.count({
        where: { ...enabled, connectionStatus: "CONNECTED" },
      }),
      prisma.employeeDirectoryMapping.count({
        where: {
          organization: { erpNextEnabled: true },
          OR: [{ matchStatus: { not: "MATCHED" } }, { normalizedStatus: null }],
        },
      }),
      prisma.employeeDirectorySyncRun.findFirst({
        where: { organization: { erpNextEnabled: true } },
        orderBy: { startedAt: "desc" },
        select: {
          startedAt: true,
          completedAt: true,
          status: true,
          correlationId: true,
          safeErrorCode: true,
        },
      }),
      prisma.employeeDirectoryIntegration.aggregate({
        where: enabled,
        _max: { lastSuccessfulSyncAt: true },
      }),
    ]);
    return {
      configuredIntegrations,
      connectedIntegrations,
      incompleteIntegrations,
      staleIntegrations,
      unresolvedEmployeeRecords,
      lastAttemptedAt: latestRun?.startedAt ?? null,
      lastCompletedAt: latestRun?.completedAt ?? null,
      lastResult: latestRun?.status ?? null,
      lastCorrelationId: latestRun?.correlationId ?? null,
      lastSafeErrorCode: latestRun?.safeErrorCode ?? null,
      lastSuccessfulAt: lastSuccessful._max.lastSuccessfulSyncAt,
    };
  },

  async getTransactionState(input: { now: Date; staleBefore: Date }) {
    const [row] = await prisma.$queryRaw<
      Array<{
        pendingSubmission: number;
        pendingConfirmation: number;
        pendingReconciliation: number;
        ambiguousOutcomes: number;
        failedOperations: number;
        failedRepayments: number;
        overdueRepayments: number;
      }>
    >`
      SELECT
        (
          (SELECT COUNT(*) FROM "LendingOffer" WHERE "fundingStatus" = 'PENDING' AND "fundingTransactionHash" IS NULL) +
          (SELECT COUNT(*) FROM "Loan" WHERE "status" = 'APPROVED' AND "contractAddress" IS NOT NULL AND "acceptanceTransactionHash" IS NULL) +
          (SELECT COUNT(*) FROM "LoanRepayment" WHERE "status" = 'PENDING' AND "submissionTransactionHash" IS NULL)
        )::int AS "pendingSubmission",
        (
          (SELECT COUNT(*) FROM "LendingOffer" WHERE "fundingStatus" = 'PENDING' AND "fundingTransactionHash" IS NOT NULL) +
          (SELECT COUNT(*) FROM "Loan" WHERE "status" IN ('REQUESTED', 'APPROVED') AND "acceptanceTransactionHash" IS NOT NULL) +
          (SELECT COUNT(*) FROM "LoanRepayment" WHERE "status" = 'PENDING' AND "submissionTransactionHash" IS NOT NULL)
        )::int AS "pendingConfirmation",
        (
          (SELECT COUNT(*) FROM "LendingOffer" offer WHERE offer."fundingStatus" = 'FUNDED' AND offer."fundingTransactionHash" IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM "BlockchainEvent" event WHERE event."transactionHash" = offer."fundingTransactionHash" AND event."name" = 'OFFER_CREATED' AND event."status" = 'APPLIED'
          )) +
          (SELECT COUNT(*) FROM "Loan" loan WHERE loan."status" IN ('ACTIVE', 'OVERDUE', 'REPAID') AND loan."acceptanceTransactionHash" IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM "BlockchainEvent" event WHERE event."transactionHash" = loan."acceptanceTransactionHash" AND event."name" = 'LOAN_STARTED' AND event."status" = 'APPLIED'
          )) +
          (SELECT COUNT(*) FROM "LoanRepayment" repayment WHERE repayment."status" = 'COMPLETED' AND repayment."submissionTransactionHash" IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM "BlockchainEvent" event WHERE event."transactionHash" = repayment."submissionTransactionHash" AND event."name" = 'LOAN_REPAID' AND event."status" = 'APPLIED'
          ))
        )::int AS "pendingReconciliation",
        (
          (SELECT COUNT(*) FROM "LendingOffer" WHERE "fundingStatus" = 'PENDING' AND "fundingTransactionHash" IS NOT NULL AND "updatedAt" < ${input.staleBefore}) +
          (SELECT COUNT(*) FROM "Loan" WHERE "status" IN ('REQUESTED', 'APPROVED') AND "acceptanceTransactionHash" IS NOT NULL AND "updatedAt" < ${input.staleBefore}) +
          (SELECT COUNT(*) FROM "LoanRepayment" WHERE "status" = 'PENDING' AND "submissionTransactionHash" IS NOT NULL AND "createdAt" < ${input.staleBefore})
        )::int AS "ambiguousOutcomes",
        (
          (SELECT COUNT(*) FROM "LendingOffer" WHERE "fundingStatus" = 'FAILED' AND "updatedAt" >= ${input.staleBefore}) +
          (SELECT COUNT(*) FROM "LoanRepayment" WHERE "status" = 'FAILED' AND "createdAt" >= ${input.staleBefore})
        )::int AS "failedOperations",
        (SELECT COUNT(*)::int FROM "LoanRepayment" WHERE "status" = 'FAILED' AND "createdAt" >= ${input.staleBefore}) AS "failedRepayments",
        (SELECT COUNT(*)::int FROM "Loan" WHERE "status" = 'OVERDUE' OR ("status" = 'ACTIVE' AND "repaymentDueAt" < ${input.now})) AS "overdueRepayments"
    `;
    return (
      row ?? {
        pendingSubmission: 0,
        pendingConfirmation: 0,
        pendingReconciliation: 0,
        ambiguousOutcomes: 0,
        failedOperations: 0,
        failedRepayments: 0,
        overdueRepayments: 0,
      }
    );
  },

  async getOperationalJobs() {
    return prisma.operationalJobHeartbeat.findMany({
      orderBy: { jobKey: "asc" },
      select: {
        jobKey: true,
        subsystem: true,
        intervalSeconds: true,
        lastAttemptedAt: true,
        lastSucceededAt: true,
        lastFailedAt: true,
        nextExpectedAt: true,
        consecutiveFailures: true,
        lastSafeErrorCode: true,
      },
    });
  },

  async getIncidentDeliveryState() {
    const [activeIncidents, pendingDeliveries, failedDeliveries] =
      await Promise.all([
        prisma.operationalIncident.count({ where: { status: "ACTIVE" } }),
        prisma.operationalIncident.count({ where: { deliveryPending: true } }),
        prisma.operationalIncident.count({
          where: {
            deliveryPending: true,
            lastDeliveryFailedAt: { not: null },
          },
        }),
      ]);
    return { activeIncidents, pendingDeliveries, failedDeliveries };
  },
};
