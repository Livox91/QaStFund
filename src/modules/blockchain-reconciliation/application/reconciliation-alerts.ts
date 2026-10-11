import { logger } from "@/infrastructure/logging/logger";

export type ReconciliationAlertState = "HEALTHY" | "STALE" | "FAILING";

export type ReconciliationAlertPayload = Readonly<{
  event: "ACTIVE" | "RECOVERED";
  state: ReconciliationAlertState;
  previousState: ReconciliationAlertState;
  occurredAt: string;
  chainId: number;
  contractAddress: string;
  detail: string;
  context: Record<string, string | number | boolean | null>;
}>;

export interface ReconciliationAlertRepository {
  prepareDelivery(input: {
    chainId: number;
    contractAddress: string;
    targetState: ReconciliationAlertState;
    now: Date;
    retryAfterMs: number;
  }): Promise<{
    deliver: boolean;
    previousState: ReconciliationAlertState;
  }>;
  markDelivered(input: {
    chainId: number;
    contractAddress: string;
    state: ReconciliationAlertState;
    now: Date;
  }): Promise<void>;
  markDeliveryFailed(input: {
    chainId: number;
    contractAddress: string;
    state: ReconciliationAlertState;
    now: Date;
  }): Promise<void>;
}

export type ReconciliationAlertSender = (
  payload: ReconciliationAlertPayload,
) => Promise<"LOG" | "WEBHOOK">;

export function createOperationalAlertSender(input: {
  webhookUrl?: string;
  bearerToken?: string;
  fetchImplementation?: typeof fetch;
}): ReconciliationAlertSender {
  return async (payload) => {
    if (!input.webhookUrl) {
      const message =
        payload.event === "RECOVERED"
          ? "Operational alert recovered"
          : "Operational alert triggered";
      const context = {
        alert: "arc_reconciliation",
        state: payload.state,
        previousState: payload.previousState,
        detail: payload.detail,
        ...payload.context,
      };
      if (payload.event === "RECOVERED") logger.info(message, context);
      else logger.warn(message, context);
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

export async function transitionReconciliationAlert(input: {
  chainId: number;
  contractAddress: string;
  targetState: ReconciliationAlertState;
  detail: string;
  context?: Record<string, string | number | boolean | null>;
  repository: ReconciliationAlertRepository;
  sender: ReconciliationAlertSender;
  now?: Date;
  retryAfterMs?: number;
}) {
  const now = input.now ?? new Date();
  const prepared = await input.repository.prepareDelivery({
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    targetState: input.targetState,
    now,
    retryAfterMs: input.retryAfterMs ?? 5 * 60_000,
  });
  if (!prepared.deliver) {
    return {
      delivered: false,
      channel: null,
      state: input.targetState,
    } as const;
  }

  const payload: ReconciliationAlertPayload = {
    event:
      input.targetState === "HEALTHY" && prepared.previousState !== "HEALTHY"
        ? "RECOVERED"
        : "ACTIVE",
    state: input.targetState,
    previousState: prepared.previousState,
    occurredAt: now.toISOString(),
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    detail: input.detail,
    context: input.context ?? {},
  };

  try {
    const channel = await input.sender(payload);
    await input.repository.markDelivered({
      chainId: input.chainId,
      contractAddress: input.contractAddress,
      state: input.targetState,
      now,
    });
    return { delivered: true, channel, state: input.targetState } as const;
  } catch (error) {
    await input.repository.markDeliveryFailed({
      chainId: input.chainId,
      contractAddress: input.contractAddress,
      state: input.targetState,
      now,
    });
    logger.error("Operational alert delivery failed", error, {
      alert: "arc_reconciliation",
      state: input.targetState,
      chainId: input.chainId,
      contractAddress: input.contractAddress,
    });
    return {
      delivered: false,
      channel: null,
      state: input.targetState,
    } as const;
  }
}
