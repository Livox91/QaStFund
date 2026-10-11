export function formatInvitationRateLimitMessage(
  retryAfterSeconds: number,
): string {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return `Too many invitation requests. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}
