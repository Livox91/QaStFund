import { describe, expect, it } from "vitest";

import { FallbackPlanner } from "@/modules/repayment-agent/application/planner";
import { amountsMentioned } from "@/modules/repayment-agent/application/validate-agent-plan";
import { createWorld } from "@/modules/repayment-agent/evals/sim-world";
import { OpenAiRepaymentPlanner } from "@/modules/repayment-agent/infrastructure/openai-planner";
import { RuleBasedRepaymentPlanner } from "@/modules/repayment-agent/infrastructure/rule-based-planner";

type Call = {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

function fakeOpenAi(responses: Array<Record<string, unknown>>) {
  const calls: Call[] = [];
  const fetchImplementation = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body)),
      headers: init.headers as Record<string, string>,
    });
    const message = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImplementation };
}

const toolCall = (id: string, name: string, args: unknown) => ({
  content: null,
  tool_calls: [
    {
      id,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});

describe("OpenAI repayment planner", () => {
  it("observes through tools, then executes a validated model decision", async () => {
    const { calls, fetchImplementation } = fakeOpenAi([
      toolCall("1", "list_outstanding_installments", {}),
      toolCall("2", "simulate_repayment", {
        action: "PAY_PARTIAL",
        loanRef: "L1",
        amountBaseUnits: "25000000",
      }),
      toolCall("3", "submit_decision", {
        action: "PAY_PARTIAL",
        loanRef: "L1",
        amountBaseUnits: "25000000",
        reasonCodes: ["INSTALLMENT_DUE_SOON", "PER_REPAYMENT_CAP_BINDING"],
        explanation:
          "Pay 25 USDC today; the cap prevents paying the full 52.5 USDC.",
        rejectedAlternatives: [
          {
            action: "PAY_FULL",
            reason: "Exceeds the 25 USDC per-repayment cap.",
          },
          { action: "WAIT", reason: "Due within 48 hours." },
        ],
        confidence: 0.91,
        nextReviewInHours: null,
      }),
      toolCall("4", "submit_decision", {
        action: "STOP",
        loanRef: null,
        amountBaseUnits: null,
        reasonCodes: ["RECENTLY_PAID"],
        explanation: "Paid today; the next payment waits for spacing.",
        rejectedAlternatives: [
          { action: "PAY_PARTIAL", reason: "Spacing policy." },
        ],
        confidence: 0.9,
        nextReviewInHours: null,
      }),
    ]);
    const planner = new OpenAiRepaymentPlanner({
      apiKey: "test-key",
      model: "test-model",
      fetchImplementation,
    });
    const world = createWorld({
      balanceUsdc: 90,
      obligations: [{ outstandingUsdc: 52.5, dueInHours: 48 }],
      planner,
    });
    const summary = await world.run();

    expect(summary.decisions.map((decision) => decision.action)).toEqual([
      "PAY_PARTIAL",
      "STOP",
    ]);
    expect(world.chain.transfers.map((item) => item.amountBaseUnits)).toEqual([
      25_000_000n,
    ]);
    expect(calls[0].headers.Authorization).toBe("Bearer test-key");
    expect(calls[0].body.model).toBe("test-model");
    // The model only ever sees pseudonymous references, not identities.
    const sent = JSON.stringify(calls.map((call) => call.body.messages));
    expect(sent).not.toContain("borrower@example.test");
    expect(sent).not.toContain("Eval Borrower");
    expect(sent).toContain("L1");
  });

  it("falls back to the rule planner when the model is unreachable", async () => {
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const planner = new FallbackPlanner(
      new OpenAiRepaymentPlanner({
        apiKey: "k",
        model: "m",
        fetchImplementation: failing,
      }),
      new RuleBasedRepaymentPlanner(),
    );
    const world = createWorld({
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 24 }],
      planner,
    });
    const summary = await world.run();
    expect(summary.decisions[0]?.action).toBe("PAY_FULL");
    const steps = [...world.repository.runs.values()].flatMap(
      (run) => run.steps,
    );
    expect(steps.some((step) => step.name === "PLANNER_FALLBACK")).toBe(true);
  });

  it("retries a malformed tool call instead of falling back", async () => {
    let requests = 0;
    const flaky = (async () => {
      requests += 1;
      if (requests === 1) {
        return new Response(
          JSON.stringify({
            error: { code: "tool_use_failed", message: "Failed to call a function." },
          }),
          { status: 400 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: toolCall("1", "submit_decision", {
                action: "WAIT",
                loanRef: null,
                amountBaseUnits: null,
                reasonCodes: ["NOT_DUE_YET"],
                explanation: "Nothing is due soon, so the agent waits.",
                rejectedAlternatives: [
                  { action: "PAY_FULL", reason: "Not due for weeks." },
                ],
                confidence: 0.8,
                nextReviewInHours: 24,
              }),
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const planner = new OpenAiRepaymentPlanner({
      apiKey: "k",
      model: "m",
      fetchImplementation: flaky,
    });
    const world = createWorld({
      balanceUsdc: 200,
      obligations: [{ outstandingUsdc: 20, dueInHours: 24 * 30 }],
      planner,
    });
    await world.run();
    expect(requests).toBeGreaterThanOrEqual(2);
    const steps = [...world.repository.runs.values()].flatMap(
      (run) => run.steps,
    );
    expect(steps.some((step) => step.name === "PLANNER_FALLBACK")).toBe(false);
  });
});

describe("explanation amount parsing", () => {
  it("reads amounts with separators and decimals", () => {
    expect(amountsMentioned("Pay 1,250.5 USDC, keep $40")).toEqual([
      1_250_500_000n,
      40_000_000n,
    ]);
  });
});
