import { describe, expect, it } from "vitest";

import { parseAgentEnvironment } from "@/modules/repayment-agent/infrastructure/agent-environment";

const key = (digit: string) => `0x${digit.repeat(64)}`;

describe("repayment agent environment", () => {
  it("is disabled by default and treats empty values as unset", () => {
    const environment = parseAgentEnvironment({
      OPENAI_API_KEY: "",
      ARC_REPAYMENT_AGENT_PRIVATE_KEY: "",
      REPAYMENT_AGENT_CRON_SECRET: "",
    });
    expect(environment.REPAYMENT_AGENT_ENABLED).toBe(false);
    expect(environment.OPENAI_API_KEY).toBeUndefined();
  });

  it("fails closed unless the V3 escrow and a distinct agent key are configured", () => {
    expect(() =>
      parseAgentEnvironment({
        REPAYMENT_AGENT_ENABLED: "true",
        ARC_ESCROW_VERSION: "1",
      }),
    ).toThrow(/ARC_ESCROW_VERSION/);
    expect(() =>
      parseAgentEnvironment({
        REPAYMENT_AGENT_ENABLED: "true",
        ARC_ESCROW_VERSION: "3",
        ARC_REPAYMENT_AGENT_PRIVATE_KEY: key("a"),
        ARC_BORROW_AUTHORIZER_PRIVATE_KEY: key("a"),
      }),
    ).toThrow(/differ/);
    expect(() =>
      parseAgentEnvironment({
        REPAYMENT_AGENT_ENABLED: "true",
        ARC_ESCROW_VERSION: "3",
        ARC_REPAYMENT_AGENT_PRIVATE_KEY: key("b"),
        OPENAI_API_KEY: "sk-test-0123456789abcdef",
      }),
    ).toThrow(/OPENAI_MODEL/);
    expect(
      parseAgentEnvironment({
        REPAYMENT_AGENT_ENABLED: "true",
        ARC_ESCROW_VERSION: "3",
        ARC_REPAYMENT_AGENT_PRIVATE_KEY: key("b"),
        ARC_BORROW_AUTHORIZER_PRIVATE_KEY: key("c"),
      }).REPAYMENT_AGENT_ENABLED,
    ).toBe(true);
  });
});
