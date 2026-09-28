import { describe, expect, it } from "vitest";

import { formatCurrencyFromMinorUnits } from "@/shared/ui/currency-display";
import { formatStatusLabel, getStatusTone } from "@/shared/ui/status-display";

describe("currency display", () => {
  it("formats integer minor units without floating-point arithmetic", () => {
    expect(
      formatCurrencyFromMinorUnits({
        amountMinorUnits: 123_456n,
        currency: "USD",
        locale: "en-US",
      }),
    ).toBe("$1,234.56");

    expect(
      formatCurrencyFromMinorUnits({
        amountMinorUnits: -505n,
        currency: "USD",
        locale: "en-US",
      }),
    ).toBe("-$5.05");
  });

  it("supports non-ISO assets with an explicit precision", () => {
    expect(
      formatCurrencyFromMinorUnits({
        amountMinorUnits: 12_345_678n,
        currency: "USDC",
        fractionDigits: 6,
        locale: "en-US",
      }),
    ).toBe("12.345678 USDC");
  });
});

describe("status display", () => {
  it("creates readable labels and applies known semantic tones", () => {
    expect(formatStatusLabel("EMPLOYER_ADMIN")).toBe("Employer Admin");
    expect(getStatusTone("completed")).toBe("success");
    expect(getStatusTone("unknown_status")).toBe("neutral");
  });
});
