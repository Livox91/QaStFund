type LogContext = Record<string, unknown>;

const sensitiveKey =
  /(?:authorization|cookie|credential|password|private[_-]?key|secret|token)/i;

export function redactLogValue(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(api[_-]?key|authorization|credential|password|private[_-]?key|secret|token)\b(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[REDACTED]",
    )
    .replace(/\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactLogValue(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue("item", item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeValue(nestedKey, nestedValue),
      ]),
    );
  }
  return value;
}

function sanitizeContext(context?: LogContext): LogContext | undefined {
  if (!context) return undefined;

  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      sanitizeValue(key, value),
    ]),
  );
}

export const logger = {
  info(message: string, context?: LogContext): void {
    console.info(redactLogValue(message), sanitizeContext(context));
  },
  warn(message: string, context?: LogContext): void {
    console.warn(redactLogValue(message), sanitizeContext(context));
  },
  error(message: string, error: unknown, context?: LogContext): void {
    console.error(redactLogValue(message), {
      ...sanitizeContext(context),
      error:
        error instanceof Error
          ? redactLogValue(error.message)
          : "Unknown error",
    });
  },
};
