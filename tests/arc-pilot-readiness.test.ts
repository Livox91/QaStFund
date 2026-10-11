import { describe, expect, it } from "vitest";

import {
  inspectPilotWalletBalances,
  inspectPilotWalletRecords,
  MIN_PILOT_NATIVE_FEE_BALANCE,
  MIN_PILOT_USDC_BALANCE,
  type PilotWalletRecord,
} from "@/modules/arc-wallet/application/arc-pilot-readiness";
import {
  getReconciliationCatchUpIssue,
  getReconciliationPreflightIssues,
} from "@/modules/blockchain-reconciliation/application/preflight-readiness";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const firstUserId = "11111111-1111-4111-8111-111111111111";
const secondUserId = "22222222-2222-4222-8222-222222222222";
const firstAddress = "0x1111111111111111111111111111111111111111";
const secondAddress = "0x2222222222222222222222222222222222222222";
const consumedAt = new Date("2026-10-10T12:00:00.000Z");

function wallet(
  userId: string,
  address: string | null,
  overrides: Partial<PilotWalletRecord> = {},
): PilotWalletRecord {
  return {
    userId,
    address,
    status: "ACTIVE",
    enrollmentState: "ACTIVE",
    ...overrides,
  };
}

describe("Arc pilot readiness", () => {
  it("reports missing wallets", () => {
    const result = inspectPilotWalletRecords([], []);
    expect(result.activeWallets).toHaveLength(0);
    expect(result.verifiedWallets).toHaveLength(0);
  });

  it("detects duplicate wallet ownership", () => {
    const result = inspectPilotWalletRecords(
      [wallet(firstUserId, firstAddress), wallet(secondUserId, firstAddress)],
      [],
    );
    expect(result.duplicateAddresses).toEqual([firstAddress]);
  });

  it("requires consumed ownership evidence for the exact user and address", () => {
    const result = inspectPilotWalletRecords(
      [wallet(firstUserId, firstAddress), wallet(secondUserId, secondAddress)],
      [
        {
          organizationId,
          userId: firstUserId,
          address: secondAddress,
          consumedAt,
        },
        {
          organizationId,
          userId: secondUserId,
          address: secondAddress,
          consumedAt: null,
        },
      ],
    );
    expect(result.verifiedWallets).toHaveLength(0);
    expect(result.unverifiedWallets).toHaveLength(2);
  });

  it("reports insufficient token and native fee balances", () => {
    const records = inspectPilotWalletRecords(
      [wallet(firstUserId, firstAddress), wallet(secondUserId, secondAddress)],
      [
        {
          organizationId,
          userId: firstUserId,
          address: firstAddress,
          consumedAt,
        },
        {
          organizationId,
          userId: secondUserId,
          address: secondAddress,
          consumedAt,
        },
      ],
    );
    const result = inspectPilotWalletBalances(
      records.verifiedWallets.map((candidate, index) => ({
        ...candidate,
        usdcBalance:
          index === 0 ? MIN_PILOT_USDC_BALANCE - 1n : MIN_PILOT_USDC_BALANCE,
        nativeFeeBalance: index === 0 ? MIN_PILOT_NATIVE_FEE_BALANCE : 0n,
      })),
    );
    expect(result.sufficientUsdc).toHaveLength(1);
    expect(result.sufficientNativeFees).toHaveLength(1);
    expect(result.readyWallets).toHaveLength(0);
  });

  it("reports reconciliation being disabled", () => {
    expect(
      getReconciliationPreflightIssues({
        enabled: false,
        rpcUrl: "https://rpc.testnet.arc.io",
        expectedRpcUrl: "https://rpc.testnet.arc.io",
        startBlock: 66_108_453n,
        latestBlock: 66_500_000n,
        cronSecret: "x".repeat(32),
      }),
    ).toEqual(["ARC_RECONCILIATION_ENABLED must be explicitly true"]);
  });

  it("reports a reconciliation cursor that has not reached finalized head", () => {
    expect(
      getReconciliationCatchUpIssue({
        cursorNextBlock: "66118453",
        latestBlock: 66_494_350n,
        confirmationDepth: 5,
        blockRange: 1_000,
      }),
    ).toBe(
      "reconciliation cursor 66118453 is 375893 blocks behind finalized block 66494345, exceeding the configured 1000-block range",
    );
    expect(
      getReconciliationCatchUpIssue({
        cursorNextBlock: "66494000",
        latestBlock: 66_494_350n,
        confirmationDepth: 5,
        blockRange: 1_000,
      }),
    ).toBeNull();
  });
});
