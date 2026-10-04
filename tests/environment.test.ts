import { describe, expect, it } from "vitest";

import {
  parseEnvironment,
  parsePublicTestnetEnvironment,
  parseTestnetEnvironment,
} from "@/infrastructure/config/environment-schema";

const startupEnvironment = {
  DATABASE_URL: "postgresql://ci_user:ci_password@localhost:5432/lending_ci",
  APP_URL: "http://localhost:3000",
};

const testnetEnvironment = {
  ARC_CHAIN_ID: "5042002",
  ARC_RPC_URL: "https://rpc.testnet.arc.network",
  ARC_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
  NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS:
    "0x1111111111111111111111111111111111111111",
  NEXT_PUBLIC_CIRCLE_CLIENT_KEY: "test-public-client-key",
  NEXT_PUBLIC_CIRCLE_CLIENT_URL:
    "https://modular-sdk.circle.com/v1/rpc/w3s/buidl",
  ARC_BORROW_AUTHORIZER_PRIVATE_KEY: `0x${"ab".repeat(32)}`,
};

describe("environment validation", () => {
  it("accepts valid startup and Arc testnet configuration", () => {
    expect(parseEnvironment(startupEnvironment)).toMatchObject({
      APP_URL: "http://localhost:3000",
      ERP_NEXT_SYNC_ENABLED: false,
    });
    expect(parseTestnetEnvironment(testnetEnvironment)).toMatchObject({
      ARC_CHAIN_ID: 5_042_002,
      ARC_USDC_ADDRESS: testnetEnvironment.ARC_USDC_ADDRESS,
    });
  });

  it("identifies configuration required at application startup", () => {
    expect(() =>
      parseEnvironment({
        DATABASE_URL: undefined,
        APP_URL: startupEnvironment.APP_URL,
      }),
    ).toThrowError(
      /local application startup \(required at startup\):[\s\S]*DATABASE_URL/,
    );
  });

  it("rejects an Arc chain ID other than the supported testnet", () => {
    expect(() =>
      parseTestnetEnvironment({
        ...testnetEnvironment,
        ARC_CHAIN_ID: "1",
      }),
    ).toThrowError(/ARC_CHAIN_ID must be 5042002 for Arc Testnet/);
  });

  it.each([
    ["ARC_USDC_ADDRESS", "not-an-address"],
    ["NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS", "0x1234"],
  ])("rejects a malformed %s", (name, value) => {
    expect(() =>
      parseTestnetEnvironment({
        ...testnetEnvironment,
        [name]: value,
      }),
    ).toThrowError(new RegExp(`${name}: must be a 20-byte EVM address`));
  });

  it("allows ERPNext to remain unconfigured while scheduled sync is disabled", () => {
    const environment = parseEnvironment({
      ...startupEnvironment,
      ERP_NEXT_SYNC_ENABLED: "false",
      ERP_NEXT_CREDENTIALS_JSON: "intentionally-not-json",
    });

    expect(environment.ERP_NEXT_SYNC_ENABLED).toBe(false);
    expect(environment.ERP_NEXT_CREDENTIALS_JSON).toBe(
      "intentionally-not-json",
    );
  });

  it("requires ERPNext credentials only when scheduled sync is enabled", () => {
    expect(() =>
      parseEnvironment({
        ...startupEnvironment,
        ERP_NEXT_SYNC_ENABLED: "true",
        ERP_NEXT_SYNC_CRON_SECRET:
          "test-only-cron-secret-at-least-32-characters",
      }),
    ).toThrowError(
      /ERP_NEXT_CREDENTIALS_JSON must be a non-empty JSON credentials object for scheduled ERPNext synchronization/,
    );
  });

  it("never returns server-only values from browser configuration", () => {
    const serverSecret = `0x${"cd".repeat(32)}`;
    const publicConfiguration = parsePublicTestnetEnvironment({
      ...testnetEnvironment,
      ARC_BORROW_AUTHORIZER_PRIVATE_KEY: serverSecret,
      DATABASE_URL: startupEnvironment.DATABASE_URL,
    });

    expect(Object.keys(publicConfiguration)).toEqual([
      "NEXT_PUBLIC_CIRCLE_CLIENT_KEY",
      "NEXT_PUBLIC_CIRCLE_CLIENT_URL",
      "NEXT_PUBLIC_ARC_LENDING_CONTRACT_ADDRESS",
    ]);
    expect(JSON.stringify(publicConfiguration)).not.toContain(serverSecret);
    expect(JSON.stringify(publicConfiguration)).not.toContain("DATABASE_URL");
  });
});
