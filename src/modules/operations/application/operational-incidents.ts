import { logger } from "@/infrastructure/logging/logger";

export type OperationalIncidentSeverity = "WARNING" | "CRITICAL";
export type OperationalIncidentEvent = "ACTIVE" | "RECOVERED";

export type OperationalIncidentDefinition = Readonly<{
  deduplicationKey: string;
  organizationId?: string;
  subsystem: string;
  kind: string;
  severity: OperationalIncidentSeverity;
  safeReferenceId: string;
  summary: string;
  remediation: string;
  metadata?: Record<string, string | number | boolean | null>;
}>;

export type OperationalIncidentPayload = Readonly<{
  incidentId: string;
  event: OperationalIncidentEvent;
  severity: OperationalIncidentSeverity;
  eventTime: string;
  subsystem: string;
  kind: string;
  referenceId: string;
  summary: string;
  remediation: string;
  metadata: Record<string, string | number | boolean | null>;
}>;

export interface OperationalIncidentRepository {
  prepareTransition(input: {
    definition: OperationalIncidentDefinition;
    active: boolean;
    now: Date;
    retryAfterMs: number;
  }): Promise<{
    incidentId: string | null;
    deliver: boolean;
    event: OperationalIncidentEvent | null;
  }>;
  markDelivered(input: { incidentId: string; now: Date }): Promise<void>;
  markDeliveryFailed(input: { incidentId: string; now: Date }): Promise<void>;
}

export type OperationalIncidentSender = (
  payload: OperationalIncidentPayload,
) => Promise<"LOG" | "WEBHOOK">;

export function createOperationalIncidentSender(input: {
  webhookUrl?: string;
  bearerToken?: string;
  fetchImplementation?: typeof fetch;
}): OperationalIncidentSender {
  return async (payload) => {
    if (!input.webhookUrl) {
      const context = {
        incidentId: payload.incidentId,
        event: payload.event,
        severity: payload.severity,
        subsystem: payload.subsystem,
        kind: payload.kind,
        referenceId: payload.referenceId,
        summary: payload.summary,
        remediation: payload.remediation,
        ...payload.metadata,
      };
      if (payload.event === "RECOVERED") {
        logger.info("Operational incident recovered", context);
      } else {
        logger.warn("Operational incident active", context);
      }
      return "LOG";
    }

    const response = await (input.fetchImplementation ?? fetch)(
      input.webhookUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(input.bearerToken
            ? { Authorization: `Bearer ${input.bearerToken}` }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Operational alert webhook returned ${response.status}`);
    }
    return "WEBHOOK";
  };
}

export async function transitionOperationalIncident(input: {
  definition: OperationalIncidentDefinition;
  active: boolean;
  repository: OperationalIncidentRepository;
  sender: OperationalIncidentSender;
  now?: Date;
  retryAfterMs?: number;
}) {
  const now = input.now ?? new Date();
  const prepared = await input.repository.prepareTransition({
    definition: input.definition,
    active: input.active,
    now,
    retryAfterMs: input.retryAfterMs ?? 5 * 60_000,
  });
  if (!prepared.deliver || !prepared.event || !prepared.incidentId) {
    return { delivered: false, channel: null, event: null } as const;
  }

  const payload: OperationalIncidentPayload = {
    incidentId: prepared.incidentId,
    event: prepared.event,
    severity: input.definition.severity,
    eventTime: now.toISOString(),
    subsystem: input.definition.subsystem,
    kind: input.definition.kind,
    referenceId: input.definition.safeReferenceId,
    summary: input.definition.summary,
    remediation: input.definition.remediation,
    metadata: input.definition.metadata ?? {},
  };
  try {
    const channel = await input.sender(payload);
    await input.repository.markDelivered({
      incidentId: prepared.incidentId,
      now,
    });
    return { delivered: true, channel, event: prepared.event } as const;
  } catch (error) {
    await input.repository.markDeliveryFailed({
      incidentId: prepared.incidentId,
      now,
    });
    logger.error("Operational incident delivery failed", error, {
      incidentId: prepared.incidentId,
      subsystem: input.definition.subsystem,
      kind: input.definition.kind,
      referenceId: input.definition.safeReferenceId,
    });
    return { delivered: false, channel: null, event: prepared.event } as const;
  }
}
