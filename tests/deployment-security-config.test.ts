import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");

describe("production deployment security configuration", () => {
  it("keeps internal scheduler routes off the public reverse proxy", () => {
    const caddyfile = readFileSync(
      resolve(repositoryRoot, "deploy/Caddyfile"),
      "utf8",
    );

    expect(caddyfile).toMatch(/@internal_api\s+path \/api\/internal\/\*/);
    expect(caddyfile).toMatch(/respond @internal_api 404/);
  });

  it("sets the checked-in baseline browser security headers", () => {
    const caddyfile = readFileSync(
      resolve(repositoryRoot, "deploy/Caddyfile"),
      "utf8",
    );

    expect(caddyfile).toContain('Strict-Transport-Security "max-age=31536000"');
    expect(caddyfile).toContain(
      "Content-Security-Policy \"base-uri 'self'; form-action 'self'; frame-ancestors 'none'\"",
    );
    expect(caddyfile).toContain("X-Frame-Options DENY");
    expect(caddyfile).toContain("X-Content-Type-Options nosniff");
  });

  it("publishes only Caddy while keeping the database network internal", () => {
    const compose = readFileSync(
      resolve(repositoryRoot, "compose.production.yaml"),
      "utf8",
    );
    const publishedPorts = [...compose.matchAll(/^\s+ports:\s*$/gm)];

    expect(publishedPorts).toHaveLength(1);
    expect(compose).toMatch(/networks:\r?\n\s+internal:\r?\n\s+internal: true/);
    expect(compose).toContain('- "80:80"');
    expect(compose).toContain('- "443:443"');
    expect(compose).not.toMatch(/- "(?:3000|5432):/);
  });
});
