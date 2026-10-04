import { isIP } from "node:net";

export type ProxyTrust = Readonly<{
  trustProxy: boolean;
  trustedProxyHops: number;
}>;

function normalizeIp(value: string): string | null {
  const candidate = value.trim().replace(/^\[|\]$/g, "");
  if (isIP(candidate)) return candidate;

  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return ipv4WithPort && isIP(ipv4WithPort[1]) ? ipv4WithPort[1] : null;
}

export function resolveClientAddress(
  headers: Headers,
  proxyTrust: ProxyTrust,
): string {
  if (!proxyTrust.trustProxy) return "unattributed";

  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map(normalizeIp)
    .filter((value): value is string => value !== null);
  if (forwarded?.length) {
    const index = Math.max(0, forwarded.length - proxyTrust.trustedProxyHops);
    return forwarded[index] ?? "unattributed";
  }

  return normalizeIp(headers.get("x-real-ip") ?? "") ?? "unattributed";
}
