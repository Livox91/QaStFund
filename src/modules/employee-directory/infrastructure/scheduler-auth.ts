import { timingSafeEqual } from "node:crypto";

export function isAuthorizedSchedulerRequest(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret || !authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }
  const suppliedSecret = authorizationHeader.slice("Bearer ".length);
  const expected = Buffer.from(expectedSecret);
  const supplied = Buffer.from(suppliedSecret);
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}
