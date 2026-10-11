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
    ]);
    return {
      configuredIntegrations,
      connectedIntegrations,
      incompleteIntegrations,
      staleIntegrations,
    };
  },

  async getPendingTransactionCount() {
    const [offers, loans, repayments] = await Promise.all([
      prisma.lendingOffer.count({ where: { fundingStatus: "PENDING" } }),
      prisma.loan.count({ where: { status: "REQUESTED" } }),
      prisma.loanRepayment.count({ where: { status: "PENDING" } }),
    ]);
    return offers + loans + repayments;
  },
};
