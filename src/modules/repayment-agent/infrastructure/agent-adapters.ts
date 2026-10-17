import "server-only";

import { prisma } from "@/infrastructure/database/prisma";
import {
  escapeHtml,
  transactionalEmailHtml,
} from "@/modules/notifications/domain/transactional-email";
import { emailSender } from "@/modules/notifications/infrastructure/http-email-sender";
import type {
  ReconciliationHealthReader,
  RepaymentNotifier,
} from "@/modules/repayment-agent/application/ports";

/**
 * Reads the persisted Arc reconciliation cursor for the escrow. The agent
 * treats a missing, failing or stale cursor as unhealthy and will not pay.
 */
export function createReconciliationHealthReader(input: {
  chainId: number;
  contractAddress: string;
  required: boolean;
  staleAfterMinutes: number;
}): ReconciliationHealthReader {
  return {
    async read(now) {
      if (!input.required) {
        return {
          healthy: true,
          lastSuccessfulAt: null,
          reasonCode: "RECONCILIATION_CHECK_DISABLED",
        };
      }
      const cursor = await prisma.blockchainReconciliationCursor.findUnique({
        where: {
          chainId_contractAddress: {
            chainId: input.chainId,
            contractAddress: input.contractAddress.toLowerCase(),
          },
        },
        select: { lastSuccessfulAt: true, alertState: true },
      });
      if (!cursor?.lastSuccessfulAt) {
        return {
          healthy: false,
          lastSuccessfulAt: null,
          reasonCode: "RECONCILIATION_NEVER_RAN",
        };
      }
      const stale =
        now.getTime() - cursor.lastSuccessfulAt.getTime() >
        input.staleAfterMinutes * 60_000;
      if (cursor.alertState !== "HEALTHY" || stale) {
        return {
          healthy: false,
          lastSuccessfulAt: cursor.lastSuccessfulAt,
          reasonCode: stale
            ? "RECONCILIATION_STALE"
            : `RECONCILIATION_${cursor.alertState}`,
        };
      }
      return {
        healthy: true,
        lastSuccessfulAt: cursor.lastSuccessfulAt,
        reasonCode: null,
      };
    },
  };
}

export const emailRepaymentNotifier: RepaymentNotifier = {
  async notify(profile, notification) {
    const url = `${process.env.APP_URL ?? ""}/app/agent`;
    try {
      await emailSender.send({
        to: profile.email,
        subject: `QastFund: ${notification.subject}`,
        text: `${notification.text}\n\nReview the agent's activity: ${url}`,
        html: transactionalEmailHtml({
          preheader: notification.subject,
          eyebrow: "Repayment agent",
          title: notification.subject,
          bodyHtml: `<p style="margin:0 0 20px;color:#334155;">${escapeHtml(notification.text)}</p>`,
          action: {
            label:
              notification.kind === "APPROVAL_REQUESTED"
                ? "Review and approve"
                : "View agent activity",
            url,
          },
          notice: {
            title: "Your limits stay in force",
            bodyHtml:
              '<p style="margin:0;">The agent can only repay your own QastFund loans within the mandate you signed. You can revoke it at any time.</p>',
          },
        }),
        idempotencyKey: notification.idempotencyKey,
      });
      return { delivered: true, code: null };
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "EMAIL_DELIVERY_FAILED";
      return { delivered: false, code };
    }
  },
};
