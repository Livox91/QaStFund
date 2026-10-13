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

    expect(caddyfile).toMatch(
      /@internal_api\s+path \/api\/internal \/api\/internal\/\*/,
    );
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

  it("does not give the scheduler the application signer environment", () => {
    const compose = readFileSync(
      resolve(repositoryRoot, "compose.production.yaml"),
      "utf8",
    );
    const scheduler = compose.match(
      /  reconciliation-scheduler:\r?\n([\s\S]*?)(?=\r?\n  caddy:)/,
    )?.[1];

    expect(scheduler).toBeDefined();
    expect(scheduler).not.toMatch(/\benv_file:/);
    expect(scheduler).not.toContain("ARC_BORROW_AUTHORIZER_PRIVATE_KEY");
    expect(scheduler).toContain("ARC_RECONCILIATION_CRON_SECRET:");
    expect(scheduler).toContain("ERP_NEXT_SYNC_CRON_SECRET:");
  });

  it("recreates and validates Caddy during every supported deployment", () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/deploy.yml"),
      "utf8",
    );

    expect(workflow).toMatch(/up -d --force-recreate caddy/);
    expect(workflow).toContain(
      "exec -T caddy caddy validate --config /etc/caddy/Caddyfile",
    );
    expect(workflow).toContain(
      "exec -T app node --input-type=module - < scripts/testing/verify-edge-security.mjs",
    );
    expect(workflow).toContain(
      "OPERATIONAL_HEALTH_SECRET is missing or shorter than 32 characters",
    );
    expect(workflow.indexOf("health_secret=")).toBeLessThan(
      workflow.indexOf("up -d database"),
    );
  });

  it("retains explicit application rollback images", () => {
    const compose = readFileSync(
      resolve(repositoryRoot, "compose.production.yaml"),
      "utf8",
    );
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/deploy.yml"),
      "utf8",
    );

    expect(compose).toContain("image: qastfund-app:${APP_IMAGE_TAG:-current}");
    expect(compose).toContain(
      "image: qastfund-reconciliation-scheduler:${APP_IMAGE_TAG:-current}",
    );
    expect(workflow).toContain("qastfund-app:rollback");
    expect(workflow).toContain("qastfund-reconciliation-scheduler:rollback");
    expect(workflow).not.toContain("docker image prune --all --force");
  });
});
