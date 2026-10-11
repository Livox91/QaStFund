import "server-only";

import { prisma } from "@/infrastructure/database/prisma";
import type {
  ReconciliationAlertRepository,
  ReconciliationAlertState,
} from "@/modules/blockchain-reconciliation/application/reconciliation-alerts";

export const prismaReconciliationAlertRepository: ReconciliationAlertRepository =
  {
    async prepareDelivery(input) {
      const contractAddress = input.contractAddress.toLowerCase();
      return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`reconciliation-alert:${input.chainId}:${contractAddress}`}, 0)
          ) IS NULL AS "acquired"
        `;
        const cursor =
          await transaction.blockchainReconciliationCursor.findUniqueOrThrow({
            where: {
              chainId_contractAddress: {
                chainId: input.chainId,
                contractAddress,
              },
            },
            select: {
              alertState: true,
              alertDeliveryPending: true,
              lastAlertAttemptAt: true,
            },
          });
        const previousState = cursor.alertState as ReconciliationAlertState;
        const stateChanged = previousState !== input.targetState;
        const retryDue =
          cursor.alertDeliveryPending &&
          (!cursor.lastAlertAttemptAt ||
            input.now.getTime() - cursor.lastAlertAttemptAt.getTime() >=
              input.retryAfterMs);
        const deliver = stateChanged || retryDue;
        if (deliver) {
          await transaction.blockchainReconciliationCursor.update({
            where: {
              chainId_contractAddress: {
                chainId: input.chainId,
                contractAddress,
              },
            },
            data: {
              alertState: input.targetState,
              ...(stateChanged ? { alertChangedAt: input.now } : {}),
              alertDeliveryPending: true,
              lastAlertAttemptAt: input.now,
            },
          });
        }
        return { deliver, previousState };
      });
    },

    async markDelivered(input) {
      await prisma.blockchainReconciliationCursor.updateMany({
        where: {
          chainId: input.chainId,
          contractAddress: input.contractAddress.toLowerCase(),
          alertState: input.state,
        },
        data: {
          alertDeliveryPending: false,
          lastAlertDeliveredAt: input.now,
        },
      });
    },

    async markDeliveryFailed(input) {
      await prisma.blockchainReconciliationCursor.updateMany({
        where: {
          chainId: input.chainId,
          contractAddress: input.contractAddress.toLowerCase(),
          alertState: input.state,
        },
        data: {
          alertDeliveryPending: true,
          lastAlertFailedAt: input.now,
        },
      });
    },
  };
