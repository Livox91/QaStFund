import "server-only";

import { prisma } from "@/infrastructure/database/prisma";
import type { OperationalIncidentRepository } from "@/modules/operations/application/operational-incidents";

export const prismaOperationalIncidentRepository: OperationalIncidentRepository =
  {
    async prepareTransition(input) {
      return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`operational-incident:${input.definition.deduplicationKey}`}, 0)
          ) IS NULL AS "acquired"
        `;
        const current = await transaction.operationalIncident.findUnique({
          where: { deduplicationKey: input.definition.deduplicationKey },
        });

        if (!input.active) {
          if (!current) {
            return { incidentId: null, deliver: false, event: null };
          }
          if (current.status === "RECOVERED") {
            const retryDue =
              current.deliveryPending &&
              (!current.lastDeliveryAttemptAt ||
                input.now.getTime() - current.lastDeliveryAttemptAt.getTime() >=
                  input.retryAfterMs);
            if (retryDue) {
              await transaction.operationalIncident.update({
                where: { id: current.id },
                data: { lastDeliveryAttemptAt: input.now },
              });
            }
            return {
              incidentId: current.id,
              deliver: retryDue,
              event: retryDue ? ("RECOVERED" as const) : null,
            };
          }
          const recovered = await transaction.operationalIncident.update({
            where: { id: current.id },
            data: {
              status: "RECOVERED",
              recoveredAt: input.now,
              lastDetectedAt: input.now,
              deliveryPending: true,
              lastDeliveryAttemptAt: input.now,
            },
          });
          return {
            incidentId: recovered.id,
            deliver: true,
            event: "RECOVERED" as const,
          };
        }

        if (!current) {
          const created = await transaction.operationalIncident.create({
            data: {
              ...input.definition,
              status: "ACTIVE",
              firstDetectedAt: input.now,
              lastDetectedAt: input.now,
              lastDeliveryAttemptAt: input.now,
              deliveryPending: true,
            },
          });
          return {
            incidentId: created.id,
            deliver: true,
            event: "ACTIVE" as const,
          };
        }

        const reactivated = current.status === "RECOVERED";
        const retryDue =
          current.deliveryPending &&
          (!current.lastDeliveryAttemptAt ||
            input.now.getTime() - current.lastDeliveryAttemptAt.getTime() >=
              input.retryAfterMs);
        const deliver = reactivated || retryDue;
        const updated = await transaction.operationalIncident.update({
          where: { id: current.id },
          data: {
            organizationId: input.definition.organizationId,
            subsystem: input.definition.subsystem,
            kind: input.definition.kind,
            severity: input.definition.severity,
            safeReferenceId: input.definition.safeReferenceId,
            summary: input.definition.summary,
            remediation: input.definition.remediation,
            metadata: input.definition.metadata,
            status: "ACTIVE",
            recoveredAt: null,
            lastDetectedAt: input.now,
            occurrenceCount: { increment: 1 },
            ...(deliver
              ? {
                  deliveryPending: true,
                  lastDeliveryAttemptAt: input.now,
                }
              : {}),
          },
        });
        return {
          incidentId: updated.id,
          deliver,
          event: deliver ? ("ACTIVE" as const) : null,
        };
      });
    },

    async markDelivered(input) {
      await prisma.operationalIncident.update({
        where: { id: input.incidentId },
        data: {
          deliveryPending: false,
          lastDeliveredAt: input.now,
        },
      });
    },

    async markDeliveryFailed(input) {
      await prisma.operationalIncident.update({
        where: { id: input.incidentId },
        data: {
          deliveryPending: true,
          lastDeliveryFailedAt: input.now,
        },
      });
    },
  };
