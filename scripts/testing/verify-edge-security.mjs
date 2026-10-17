import assert from "node:assert/strict";

const baseUrl = new URL(process.env.EDGE_BASE_URL ?? process.env.APP_URL ?? "");
if (baseUrl.protocol !== "https:") {
  throw new Error("EDGE_BASE_URL must be an HTTPS origin.");
}

const healthSecret =
  process.env.EDGE_HEALTH_SECRET ?? process.env.OPERATIONAL_HEALTH_SECRET;
if (!healthSecret) {
  throw new Error(
    "EDGE_HEALTH_SECRET is required for authenticated verification.",
  );
}

if (process.env.EDGE_ALLOW_INSECURE_TLS === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const httpUrl = new URL(process.env.EDGE_HTTP_URL ?? baseUrl);
httpUrl.protocol = "http:";
const checks = [];

async function request(name, path, options = {}) {
  const response = await fetch(new URL(path, options.baseUrl ?? baseUrl), {
    method: "GET",
    headers: options.authenticated
      ? { Authorization: `Bearer ${healthSecret}` }
      : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  checks.push({ name, status: response.status });
  return response;
}

function assertSecurityHeaders(response, label) {
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=31536000",
    `${label} must include HSTS`,
  );
  assert.equal(
    response.headers.get("content-security-policy"),
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    `${label} must include the baseline CSP`,
  );
  assert.equal(
    response.headers.get("x-frame-options"),
    "DENY",
    `${label} must deny framing`,
  );
  assert.equal(
    response.headers.get("x-content-type-options"),
    "nosniff",
    `${label} must disable content sniffing`,
  );
  assert.equal(
    response.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
    `${label} must set the referrer policy`,
  );
  assert.equal(
    response.headers.get("permissions-policy"),
    "camera=(), microphone=(), geolocation=()",
    `${label} must set the permissions policy`,
  );
  assert.equal(response.headers.get("server"), null, `${label} leaks Server`);
}

const redirect = await request("http-redirect", "/", { baseUrl: httpUrl });
assert.ok(
  [301, 302, 307, 308].includes(redirect.status),
  `HTTP request returned ${redirect.status} instead of a redirect`,
);
const location = new URL(redirect.headers.get("location") ?? "", httpUrl);
assert.equal(location.protocol, "https:");
assert.equal(location.hostname, baseUrl.hostname);

for (const path of ["/api/health/live", "/api/health/ready"]) {
  const response = await request(`public-${path.split("/").at(-1)}`, path);
  assert.equal(response.status, 200, `${path} must remain publicly available`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assertSecurityHeaders(response, path);
}

const unauthorized = await request(
  "dependency-health-unauthenticated",
  "/api/health/dependencies",
);
assert.equal(unauthorized.status, 401);
assert.equal(unauthorized.headers.get("cache-control"), "no-store");
assertSecurityHeaders(unauthorized, "unauthenticated dependency health");

const authorized = await request(
  "dependency-health-authenticated",
  "/api/health/dependencies",
  { authenticated: true },
);
assert.ok(
  [200, 503].includes(authorized.status),
  `authenticated dependency health returned unexpected status ${authorized.status}`,
);
assert.equal(authorized.headers.get("cache-control"), "no-store");
assertSecurityHeaders(authorized, "authenticated dependency health");

for (const path of [
  "/api/internal",
  "/api/internal/arc-reconciliation",
  "/api/internal/erpnext-sync",
  "/api/internal/repayment-operations",
  "/api/internal/repayment-agent",
]) {
  const response = await request(
    `internal-denied-${path.split("/").at(-1)}`,
    path,
  );
  assert.equal(response.status, 404, `${path} must be denied at the edge`);
  assertSecurityHeaders(response, path);
}

console.log(
  JSON.stringify({ ok: true, target: baseUrl.hostname, checks }, null, 2),
);
