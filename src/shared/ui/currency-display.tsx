import { cn } from "@/shared/utils/class-names";

type CurrencyFormatOptions = {
  amountMinorUnits: bigint;
  currency?: string;
  fractionDigits?: number;
  locale?: string;
};

function getCurrencyFormatter(
  currency: string,
  locale: string,
  fractionDigits?: number,
) {
  try {
    return new Intl.NumberFormat(locale, {
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
      style: "currency",
    });
  } catch {
    return null;
  }
}

export function formatCurrencyFromMinorUnits({
  amountMinorUnits,
  currency = "USD",
  fractionDigits,
  locale = "en-US",
}: CurrencyFormatOptions): string {
  const formatter = getCurrencyFormatter(currency, locale, fractionDigits);
  const digits =
    fractionDigits ?? formatter?.resolvedOptions().maximumFractionDigits ?? 2;

  if (!Number.isInteger(digits) || digits < 0 || digits > 20) {
    throw new RangeError("fractionDigits must be an integer between 0 and 20");
  }

  const negative = amountMinorUnits < 0n;
  const absoluteAmount = negative ? -amountMinorUnits : amountMinorUnits;
  const scale = 10n ** BigInt(digits);
  const whole = absoluteAmount / scale;
  const fraction = (absoluteAmount % scale).toString().padStart(digits, "0");
  const groupedWhole = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(whole);

  if (!formatter) {
    const decimalSeparator = new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value;
    const amount = digits
      ? `${groupedWhole}${decimalSeparator ?? "."}${fraction}`
      : groupedWhole;

    return `${negative ? "-" : ""}${amount} ${currency}`;
  }

  let integerWritten = false;

  return formatter
    .formatToParts(negative ? -1 : 1)
    .flatMap((part) => {
      if (part.type === "integer") {
        if (integerWritten) return [];
        integerWritten = true;
        return [{ ...part, value: groupedWhole }];
      }
      if (part.type === "group") return [];
      if (part.type === "fraction") return [{ ...part, value: fraction }];
      if (digits === 0 && part.type === "decimal") return [];
      return [part];
    })
    .map((part) => part.value)
    .join("");
}

export function CurrencyDisplay({
  amountMinorUnits,
  className,
  currency = "USD",
  fractionDigits,
  locale = "en-US",
}: CurrencyFormatOptions & { className?: string }) {
  return (
    <span
      className={cn("font-medium tabular-nums", className)}
      data-currency={currency}
    >
      {formatCurrencyFromMinorUnits({
        amountMinorUnits,
        currency,
        fractionDigits,
        locale,
      })}
    </span>
  );
}
