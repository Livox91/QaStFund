import "server-only";

import { prisma } from "@/infrastructure/database/prisma";
import type { OperationalJobRepository } from "@/modules/operations/application/monitored-job";

export const prismaOperationalJobRepository: OperationalJobRepository = {
  async recordAttempt(input) {
    await prisma.operationalJobHeartbeat.upsert({
      where: { jobKey: input.jobKey },
      create: {
        jobKey: input.jobKey,
        subsystem: input.subsystem,
        intervalSeconds: input.intervalSeconds,
        lastAttemptedAt: input.attemptedAt,
        nextExpectedAt: new Date(
          input.attemptedAt.getTime() + input.intervalSeconds * 1_000,
        ),
      },
      update: {
        subsystem: input.subsystem,
        intervalSeconds: input.intervalSeconds,
        lastAttemptedAt: input.attemptedAt,
        nextExpectedAt: new Date(
          input.attemptedAt.getTime() + input.intervalSeconds * 1_000,
        ),
      },
    });
  },

  async recordSuccess(input) {
    await prisma.operationalJobHeartbeat.update({
      where: { jobKey: input.jobKey },
      data: {
        lastSucceededAt: input.succeededAt,
        consecutiveFailures: 0,
        lastSafeErrorCode: null,
      },
    });
  },

  async recordFailure(input) {
    await prisma.operationalJobHeartbeat.update({
      where: { jobKey: input.jobKey },
      data: {
        lastFailedAt: input.failedAt,
        consecutiveFailures: { increment: 1 },
        lastSafeErrorCode: input.safeErrorCode,
      },
    });
  },
};
