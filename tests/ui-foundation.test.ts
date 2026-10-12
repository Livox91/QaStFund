import { describe, expect, it } from "vitest";

import { formatCurrencyFromMinorUnits } from "@/shared/ui/currency-display";
import { buttonStyles } from "@/shared/ui/button";
import { formatStatusLabel, getStatusTone } from "@/shared/ui/status-display";
import { cn } from "@/shared/utils/class-names";

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

describe("inverse controls", () => {
  it.each(["primary", "danger", "inverseOutline"] as const)(
    "keeps %s button text visible on a dark background",
    (variant) => {
      expect(buttonStyles({ variant })).toContain("!text-white");
    },
  );

  it("uses readable brand text for the soft secondary action", () => {
    const styles = buttonStyles({ variant: "secondary" });

    expect(styles).toContain("bg-brand-soft");
    expect(styles).toContain("!text-brand");
  });

  it("provides inverse variants without conflicting surface utilities", () => {
    const solid = buttonStyles({ variant: "inverse" });
    const outline = buttonStyles({ variant: "inverseOutline" });

    expect(solid).toContain("bg-white");
    expect(solid).toContain("!text-slate-950");
    expect(solid).not.toContain("bg-brand ");
    expect(outline).toContain("bg-transparent");
    expect(outline).toContain("border-white/30");
    expect(outline).not.toContain("bg-white ");
  });
});

describe("class name composition", () => {
  it("lets caller-provided button styles replace variant defaults", () => {
    expect(cn("bg-brand !text-white", "bg-white !text-slate-950")).toBe(
      "bg-white !text-slate-950",
    );
  });
});
