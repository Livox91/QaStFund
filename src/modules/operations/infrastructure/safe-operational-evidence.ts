const sensitiveKey =
  /(?:authorization|borrowerName|cookie|credential|email|employeeName|full.?name|lenderName|password|private[_-]?key|requestedByName|secret|signature|token)/i;

function maskAddress(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function sanitizeOperationalEvidence(
  value: unknown,
  key = "value",
): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) return maskAddress(value);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "[REDACTED]";
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeOperationalEvidence(item, "item"));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeOperationalEvidence(nestedValue, nestedKey),
      ]),
    );
  }
  return value;
}
