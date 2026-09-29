export const USDC_DECIMALS = 6;
export const USDC_BASE_UNITS_PER_CENT = 10_000n;

export function parseUsdc(value: string): bigint {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error("Enter a valid USDC amount with up to 6 decimals.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function parseUsdcCents(value: string): {
  baseUnits: bigint;
  minorUnits: bigint;
} {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new Error("Enter a valid amount with up to 2 decimals.");
  }
  const baseUnits = parseUsdc(value);
  if (baseUnits <= 0n) throw new Error("Amount must be greater than zero.");
  return { baseUnits, minorUnits: baseUnits / USDC_BASE_UNITS_PER_CENT };
}

export function parsePercentToBasisPoints(value: string): number {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a percentage with up to 2 decimals.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (result > 10_000) throw new Error("Interest cannot exceed 100%.");
  return result;
}

export function formatUsdc(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const fraction = (baseUnits % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
