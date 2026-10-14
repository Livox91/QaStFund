import {
  encodeEventTopics,
  padHex,
  toHex,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_USDC_ADDRESS,
} from "@/integrations/arc/arc-testnet";
import {
  hasExactSingleOutgoingUsdcTransfer,
  normalizeArcTransferRecipient,
} from "@/modules/arc-wallet/domain/arc-usdc-transfer";
import {
  parseUsdcBaseUnits,
  prepareArcUsdcTransferSchema,
} from "@/modules/arc-wallet/schemas/arc-usdc-transfer.schema";
import { readLimitedJson } from "@/shared/api/read-json-body";

const sender = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;

function transferLog(from: Address, to: Address, value: bigint): Log {
  const topics = encodeEventTopics({
    abi: [
      {
        type: "event",
        name: "Transfer",
        inputs: [
          { indexed: true, name: "from", type: "address" },
          { indexed: true, name: "to", type: "address" },
          { indexed: false, name: "value", type: "uint256" },
        ],
      },
    ],
    eventName: "Transfer",
    args: { from, to },
  });
  return {
    address: ARC_USDC_ADDRESS,
    topics: topics as [Hex, ...Hex[]],
    data: padHex(toHex(value), { size: 32 }),
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    transactionHash: null,
    transactionIndex: null,
    removed: false,
  };
}

describe("Arc Testnet USDC transfer validation", () => {
  it("parses valid values only with integer base-unit arithmetic", () => {
    expect(parseUsdcBaseUnits("1")).toBe(1_000_000n);
    expect(parseUsdcBaseUnits("0.000001")).toBe(1n);
    expect(parseUsdcBaseUnits("12.345678")).toBe(12_345_678n);
  });

  it.each(["0", "-1", "1.0000001", "NaN", "Infinity", "1e3", "01"])(
    "rejects malformed or unsafe amount %s",
    (amount) => expect(() => parseUsdcBaseUnits(amount)).toThrow(),
  );

  it("normalizes valid EVM addresses and warns on self-transfer", () => {
    expect(
      normalizeArcTransferRecipient(
        sender.toUpperCase().replace("0X", "0x"),
        sender,
      ),
    ).toEqual({ recipient: sender, selfTransfer: true });
  });

  it.each(["not-an-address", "0x0000000000000000000000000000000000000000"])(
    "rejects invalid recipient %s",
    (address) => expect(() => normalizeArcTransferRecipient(address)).toThrow(),
  );

  it("rejects an unsupported chain, token, and arbitrary calldata", () => {
    const base = {
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      recipient,
      amount: "1",
      chainId: ARC_TESTNET_CHAIN_ID,
      tokenAddress: ARC_USDC_ADDRESS,
    };
    expect(prepareArcUsdcTransferSchema.safeParse(base).success).toBe(true);
    expect(
      prepareArcUsdcTransferSchema.safeParse({ ...base, chainId: 1 }).success,
    ).toBe(false);
    expect(
      prepareArcUsdcTransferSchema.safeParse({ ...base, tokenAddress: sender })
        .success,
    ).toBe(false);
    expect(
      prepareArcUsdcTransferSchema.safeParse({
        ...base,
        calldata: "0xdeadbeef",
      }).success,
    ).toBe(false);
  });

  it("accepts only one exact outgoing USDC transfer", () => {
    const exact = transferLog(sender, recipient, 1_000_000n);
    const input = { sender, recipient, amountBaseUnits: 1_000_000n };
    expect(hasExactSingleOutgoingUsdcTransfer([exact], input)).toBe(true);
    expect(
      hasExactSingleOutgoingUsdcTransfer(
        [transferLog(sender, recipient, 2_000_000n)],
        input,
      ),
    ).toBe(false);
    expect(
      hasExactSingleOutgoingUsdcTransfer(
        [
          exact,
          transferLog(sender, "0x3333333333333333333333333333333333333333", 1n),
        ],
        input,
      ),
    ).toBe(false);
  });

  it("rejects oversized API request bodies", async () => {
    const request = new Request(
      "https://qastfund.test/api/wallet/arc/transfers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(4_096) }),
      },
    );
    await expect(readLimitedJson(request)).rejects.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      statusCode: 413,
    });
  });
});
