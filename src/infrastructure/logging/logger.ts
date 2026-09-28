type LogContext = Record<string, unknown>;

export const logger = {
  error(message: string, error: unknown, context?: LogContext): void {
    console.error(message, {
      ...context,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  },
};
