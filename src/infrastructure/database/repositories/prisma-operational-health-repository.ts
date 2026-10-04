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

  async getErpNextState() {
    const [configuredIntegrations, failedIntegrations] = await Promise.all([
      prisma.employeeDirectoryIntegration.count(),
      prisma.employeeDirectoryIntegration.count({
        where: { lastSyncStatus: { in: ["FAILED", "PARTIAL"] } },
      }),
    ]);
    return { configuredIntegrations, failedIntegrations };
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
