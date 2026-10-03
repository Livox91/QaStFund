import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { EmployeeDirectoryError } from "@/modules/employee-directory/domain/employee-directory";

export type HostResolver = (hostname: string) => Promise<ReadonlyArray<string>>;

export const resolveHost: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(
    (address) => address.address,
  );

function unsafeIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
}

function unsafeIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return unsafeIpv4(ip);
  if (version !== 6) return true;
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    return isIP(mappedIpv4) !== 4 || unsafeIpv4(mappedIpv4);
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}

export async function validateErpNextBaseUrl(
  rawBaseUrl: string,
  resolver: HostResolver = resolveHost,
  allowLocalDevelopment = false,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new EmployeeDirectoryError("UNSAFE_URL");
  }
  const localHost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const localAllowed =
    process.env.NODE_ENV !== "production" && allowLocalDevelopment && localHost;
  if (
    (url.protocol !== "https:" && !localAllowed) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!localAllowed && localHost)
  ) {
    throw new EmployeeDirectoryError("UNSAFE_URL");
  }
  const addresses = await resolver(url.hostname).catch(() => {
    throw new EmployeeDirectoryError("UNSAFE_URL");
  });
  if (addresses.length === 0 || (!localAllowed && addresses.some(unsafeIp))) {
    throw new EmployeeDirectoryError("UNSAFE_URL");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}
