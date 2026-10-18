import {
  PlannerUnavailableError,
  type PlannerRequest,
  type PlannerResult,
  type RepaymentPlanner,
} from "@/modules/repayment-agent/application/planner";
import { agentDecisionJsonSchema } from "@/modules/repayment-agent/domain/agent-decision";
import { REPAYMENT_AGENT_PROMPT_VERSION } from "@/modules/repayment-agent/domain/agent-run";
import { repaymentToolDefinitions } from "@/modules/repayment-agent/tools/repayment-tools";

const SYSTEM_PROMPT = `You are QastFund's repayment agent (${REPAYMENT_AGENT_PROMPT_VERSION}).
You manage one borrower's repayments of employee loans in USDC on Arc.

How to work:
- Observe first: call get_repayment_context, list_outstanding_installments and list_available_actions. Call get_arc_wallet_balance or get_reconciliation_health when freshness matters.
- Compare options: full payment, partial payment, waiting, notifying the borrower, requesting passkey approval for an amount outside the mandate, escalating, or stopping.
- Use simulate_repayment to test a payment before choosing it.
- Finish by calling submit_decision exactly once.

Rules you cannot override (code re-checks every one and rejects violations):
- Choose only an action listed by list_available_actions, within its amount bounds.
- Amounts are USDC base units (6 decimals) as integer strings: 25 USDC = "25000000". Partial amounts must be whole cents.
- Never pay while reconciliation is unhealthy or while a repayment is in flight.
- The borrower's minimum reserve, per-repayment cap and period cap are hard limits.
- Prioritise the earliest-due or overdue obligation. Prefer keeping liquidity when nothing is due soon.
- Ask for approval only when the needed amount exceeds what the mandate allows.

Your submit_decision must:
- use reason codes that justify the chosen action;
- state the exact amount in USDC in the explanation for payment and approval actions;
- list at least one rejected alternative with a concrete reason;
- give nextReviewInHours for WAIT.
Write explanations for the borrower in one or two plain sentences.`;

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
};

export type OpenAiPlannerConfig = Readonly<{
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTurns?: number;
  requestTimeoutMs?: number;
  fetchImplementation?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}>;

const tools = [
  ...repaymentToolDefinitions.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: true,
    },
  })),
  {
    type: "function" as const,
    function: {
      name: "submit_decision",
      description:
        "Submit the final structured decision. Code validates it before anything executes.",
      parameters: agentDecisionJsonSchema,
      strict: true,
    },
  },
];

const MAX_TOOL_CALL_ATTEMPTS = 3;
const RETRYABLE_TOOL_CALL_CODES = new Set([
  "tool_use_failed",
  "json_validate_failed",
]);

// Free tiers (e.g. Groq) cap tokens per minute and say how long to wait. A
// short wait is retried once; a longer one falls back to rules immediately.
const MAX_RATE_LIMIT_WAIT_MS = 20_000;

class ModelToolCallFailedError extends PlannerUnavailableError {}

class ModelRateLimitedError extends PlannerUnavailableError {
  constructor(
    code: string,
    readonly retryAfterMs: number,
  ) {
    super(code);
  }
}

function retryAfterMs(response: Response, message: unknown) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const match =
    typeof message === "string"
      ? /try again in ([\d.]+)s/i.exec(message)
      : null;
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class OpenAiRepaymentPlanner implements RepaymentPlanner {
  readonly kind = "MODEL" as const;
  readonly model: string;

  constructor(private readonly config: OpenAiPlannerConfig) {
    this.model = config.model;
  }

  async plan(request: PlannerRequest): Promise<PlannerResult> {
    const maxTurns = this.config.maxTurns ?? 8;
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: this.userMessage(request) },
    ];

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const forceDecision = turn === maxTurns;
      const message = await this.complete(messages, forceDecision);
      const calls = message.tool_calls ?? [];
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      if (calls.length === 0) {
        messages.push({
          role: "user",
          content: "Finish by calling submit_decision.",
        });
        continue;
      }
      for (const call of calls) {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          throw new PlannerUnavailableError("MODEL_INVALID_TOOL_ARGUMENTS");
        }
        if (call.function.name === "submit_decision") {
          return { decision: args, kind: this.kind, model: this.model };
        }
        const result = await request.toolbox.call(call.function.name, args);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }
    throw new PlannerUnavailableError("MODEL_NO_DECISION");
  }

  private userMessage(request: PlannerRequest) {
    const parts = ["Decide the next repayment action for this borrower."];
    if (request.history.length > 0) {
      parts.push(
        `Earlier in this run:\n${JSON.stringify(request.history, null, 2)}\nRe-observe before deciding; conditions may have changed.`,
      );
    }
    if (request.rejectedChecks?.length) {
      parts.push(
        `Your previous decision was rejected by policy checks:\n${JSON.stringify(
          request.rejectedChecks.map((check) => ({
            code: check.code,
            detail: check.detail,
          })),
          null,
          2,
        )}\nChoose a different, permitted action.`,
      );
    }
    return parts.join("\n\n");
  }

  private async complete(messages: ChatMessage[], forceDecision: boolean) {
    // Some OpenAI-compatible hosts (Groq with gpt-oss) answer 400
    // tool_use_failed / json_validate_failed when the model emits a malformed
    // tool call. That is a sampling failure, not a bad request, so the same
    // turn is retried before the planner falls back to rules.
    let rateLimitRetried = false;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.completeOnce(messages, forceDecision);
      } catch (error) {
        if (error instanceof ModelRateLimitedError && !rateLimitRetried) {
          rateLimitRetried = true;
          await (this.config.sleep ?? defaultSleep)(error.retryAfterMs);
          continue;
        }
        if (
          !(error instanceof ModelToolCallFailedError) ||
          attempt >= MAX_TOOL_CALL_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
  }

  private async completeOnce(messages: ChatMessage[], forceDecision: boolean) {
    const fetchImplementation = this.config.fetchImplementation ?? fetch;
    let response: Response;
    try {
      response = await fetchImplementation(
        `${(this.config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            tools,
            parallel_tool_calls: false,
            tool_choice: forceDecision
              ? { type: "function", function: { name: "submit_decision" } }
              : "auto",
          }),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 45_000),
        },
      );
    } catch {
      throw new PlannerUnavailableError("MODEL_UNREACHABLE");
    }
    if (!response.ok) {
      // The provider's error message explains rejected requests (unsupported
      // parameter, bad model name). It is logged server-side only; the
      // activity log records just the status code.
      const providerError = (await response
        .json()
        .then((errorBody: { error?: unknown } | null) => errorBody?.error)
        .catch(() => undefined)) as
        { code?: unknown; message?: unknown } | undefined;
      const code =
        typeof providerError?.code === "string"
          ? providerError.code
          : undefined;
      console.warn("repayment-agent model request rejected", {
        status: response.status,
        model: this.model,
        code,
        message:
          typeof providerError?.message === "string"
            ? providerError.message.slice(0, 500)
            : undefined,
      });
      if (response.status === 429) {
        const waitMs = retryAfterMs(response, providerError?.message);
        if (waitMs !== null && waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
          throw new ModelRateLimitedError("MODEL_HTTP_429", waitMs);
        }
      }
      if (code && RETRYABLE_TOOL_CALL_CODES.has(code)) {
        throw new ModelToolCallFailedError(`MODEL_HTTP_${response.status}`);
      }
      throw new PlannerUnavailableError(`MODEL_HTTP_${response.status}`);
    }
    const body = (await response
      .json()
      .catch(() => null)) as ChatResponse | null;
    const message = body?.choices?.[0]?.message;
    if (!message) throw new PlannerUnavailableError("MODEL_EMPTY_RESPONSE");
    return message;
  }
}
