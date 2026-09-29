import { describe, expect, it } from "vitest";

import { fundingRequestIdToBytes32 } from "@/integrations/arc/employee-lending-escrow";
import { fundedLendingOfferSchema } from "@/modules/lending/schemas/funded-lending-offer.schema";
import {
  formatUsdc,
  parsePercentToBasisPoints,
  parseUsdc,
  parseUsdcCents,
} from "@/shared/money/usdc";

describe("funded lending offer values", () => {
  it("converts display values without floating-point arithmetic", () => {
    expect(parseUsdc("100.123456")).toBe(100_123_456n);
    expect(parseUsdcCents("100.25")).toEqual({
      baseUnits: 100_250_000n,
      minorUnits: 10_025n,
    });
    expect(parsePercentToBasisPoints("5.25")).toBe(525);
    expect(formatUsdc(100_123_400n)).toBe("100.1234");
  });

  it("rejects values that cannot round-trip through the cents-based app model", () => {
    expect(() => parseUsdcCents("1.001")).toThrow("up to 2 decimals");
    expect(() => parseUsdcCents("0")).toThrow("greater than zero");
    expect(() => parsePercentToBasisPoints("100.01")).toThrow(
      "cannot exceed 100%",
    );
  });

  it("creates exact base-unit and contract terms from an API request", () => {
    const requestId = "fb709ef7-967f-46df-9055-e20b9b6df846";
    const result = fundedLendingOfferSchema.parse({
      requestId,
      amount: "75.50",
      interestRate: "4.25",
      durationDays: 30,
    });
    expect(result).toEqual({
      requestId,
      principalBaseUnits: 75_500_000n,
      amountMinorUnits: 7_550n,
      feeRateBasisPoints: 425,
      durationDays: 30,
      durationSeconds: 2_592_000,
    });
    expect(fundingRequestIdToBytes32(requestId)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
