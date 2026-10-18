# QastFund Production Environment Audit

**Audit date:** 2026-10-18  
**Scope:** repository configuration, the ignored local production environment,
safe local builds/tests, and read-only HTTPS probes of `qastfund.com`  
**Overall status:** **FAIL — not financially production-ready**

The checked-in deployment is suitable for a controlled, production-hosted Arc
Testnet pilot after one configuration blocker is corrected. It must not be
described as financial production: signing keys remain in a plaintext host env
file, managed signer custody and rotation are not implemented, target-host
restore/rollback has not been demonstrated, and ERPNext least-privilege access
was not independently verified. No contract was deployed, no key was rotated,
and no transaction, approval, payroll mutation, or fund transfer was performed
during this audit.

## 1. Executive summary and readiness

| Control                                | Status      | Evidence / limitation                                                                                                                                                                                                    |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository production build            | **PASS**    | `npm run build` completed; the post-build sanitizer removed the generated standalone `.env`.                                                                                                                             |
| Automated checks                       | **PASS**    | Lint and typecheck passed; 82 test files and 524 tests passed, with one file/test intentionally skipped.                                                                                                                 |
| Explicit production startup validation | **PASS**    | `DEPLOYMENT_ENV=production` now rejects unsafe URLs, disabled/weak rate limiting, missing health auth, local ERP HTTP, invalid Arc Testnet configuration, invalid agent configuration, and reused purpose-bound secrets. |
| Local production configuration         | **FAIL**    | `npm run verify:production-env` rejects reuse of one bearer value for both Arc reconciliation and ERPNext synchronization. Values were not printed or changed.                                                           |
| Public edge and health surface         | **PASS**    | Read-only live probes returned HTTPS `200`, HTTP-to-HTTPS `308`, live/ready `200`, unauthenticated dependency health `401`, and public internal route `404`; required headers were present.                              |
| Live dependency state                  | **PASS**    | Authenticated read-only health reported Arc, Circle, ERPNext, and reconciliation healthy at audit time. This is point-in-time health, not transaction verification.                                                      |
| Signing-key custody and rotation       | **FAIL**    | Borrow-authorizer and repayment-agent private keys are supplied through the ignored production env file. No KMS/HSM/managed signer, rotation proof, or break-glass process exists.                                       |
| ERPNext production assurance           | **PARTIAL** | HTTPS/SSRF controls and live health pass. Role permissions, site boundary, and the known mixed Frappe/ERPNext/HRMS branches remain unresolved.                                                                           |
| Recovery and rollback                  | **BLOCKED** | Tooling and rollback image tags exist, but restore and rollback have not been demonstrated on the target host.                                                                                                           |

## 2. Production deployment architecture

The intended and observed topology is:

1. A push to `master` runs GitHub Actions CI with PostgreSQL 17, dependency
   policy, typecheck, lint, format, migrations, disaster-recovery verification,
   application tests, contract tests, and a production build.
2. A successful push-triggered CI workflow starts the deployment workflow.
   Deployments are now serialized and associated with the GitHub `production`
   environment.
3. The workflow connects to an EC2 host over SSH, fast-forwards to the exact CI
   SHA, validates Compose, preserves current application images as rollback
   tags, starts PostgreSQL, applies Prisma migrations, and rebuilds the app,
   scheduler, and Caddy.
4. Caddy is the only public service (TCP/UDP 80/443). The app and PostgreSQL are
   attached to private Compose networks; PostgreSQL has no production host port.
5. The app is a non-root Next.js standalone Node 24 container. The standalone
   image does not include repository scripts, Prisma seed code, Hardhat, or
   Vitest.
6. A separate non-root scheduler container calls authenticated internal routes
   over Docker's internal network. Caddy blocks `/api/internal/**` and now also
   blocks `/api/dev/**` at the edge.

The repository does not prove which commit is running on EC2. The public
behavior matches the checked-in health/internal-route hardening, but host image
IDs, Compose state, security groups, disk encryption, and deployed environment
contents were not available for direct inspection.

## 3. Development-only artifacts found

| Artifact                                                                            | Classification                                               | Production handling                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env`, local PostgreSQL URL, local HTTP app URL, and `ERP_NEXT_ALLOW_LOCAL_HTTP`   | Expected local development configuration                     | `.env*` is ignored. Production mode rejects local HTTP ERPNext and non-HTTPS/loopback `APP_URL`.                                                           |
| `compose.yaml` with `postgres/postgres` and port 5432                               | Local-only convenience                                       | Not referenced by the production workflow. `compose.production.yaml` uses required operator-supplied credentials and no database host port.                |
| Hardhat local mnemonic, chain reset/deploy scripts, fixtures, and test dependencies | CI/local-only                                                | They remain for reproducibility and are absent from the standalone runtime image.                                                                          |
| `/api/dev/wallet/fund`                                                              | Development endpoint                                         | Application returns `404` under `NODE_ENV=production`; Caddy now blocks `/api/dev/**` as defense in depth. The new edge rule still requires deployment.    |
| Mock employer-action adapter                                                        | Intentional simulation, not an external HR action            | Retained because no real provider exists and the UI labels outcomes as simulated. It is unsuitable as evidence that HR contact or follow-up occurred.      |
| Arc Testnet endpoints and token/contract settings                                   | Intentional pilot configuration, not accidental dev fallback | Production validation fixes the supported chain ID to Arc Testnet. No mainnet substitution was made.                                                       |
| Removed demo runners still referenced by some package scripts/docs                  | Harmless to runtime, broken local documentation/tooling      | The localhost-only seed guard was restored because `prisma db seed` imports it. Remaining stale demo commands/docs should be reconciled separately.        |
| Direct standalone build copied `.env`                                               | Material artifact leak risk                                  | `scripts/build/sanitize-standalone.mjs` now removes generated `.env*` files after every production build. Docker was already protected by `.dockerignore`. |
| Permissive CORS                                                                     | Not found                                                    | No application `Access-Control-Allow-*` configuration was found. State-changing browser routes use exact-origin checks.                                    |

## 4. Changes implemented

| File                                                                    | Change                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/infrastructure/config/environment-schema.ts`                       | Added explicit deployment mode and fail-closed production invariants, including purpose-bound secret uniqueness.                                                                              |
| `src/infrastructure/config/environment.ts`                              | Supplies deployment mode to the central validator.                                                                                                                                            |
| `src/instrumentation.ts`                                                | Validates core, Arc Testnet, and repayment-agent configuration at production Node startup.                                                                                                    |
| `tests/environment.test.ts`                                             | Covers valid production configuration and each unsafe production override, including secret reuse.                                                                                            |
| `scripts/testing/verify-production-environment.ts` and declaration file | Added a redaction-safe operator check for core, Arc, agent, and scheduler configuration.                                                                                                      |
| `Dockerfile`                                                            | Explicitly marks the runtime as production deployment mode. Existing stages retain a minimal non-root standalone runtime.                                                                     |
| `compose.production.yaml`                                               | Critical Compose values and browser build inputs are mandatory; app deployment mode is explicit.                                                                                              |
| `.env.example`, `deploy/.env.production.example`                        | Document explicit modes and a real HTTPS-only production origin.                                                                                                                              |
| `deploy/.env.production`                                                | Locally changed `ERP_NEXT_ALLOW_LOCAL_HTTP` to `false`; the ignored file was not committed or deployed. No secret value was modified.                                                         |
| `deploy/Caddyfile`                                                      | Added public denial of development API routes.                                                                                                                                                |
| `scripts/build/sanitize-standalone.mjs`, `package.json`                 | Remove env files from standalone output after build.                                                                                                                                          |
| `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`              | Pin actions to immutable commits; add least-privilege permissions, deployment concurrency/environment/timeout, pre-mutation Compose validation, and remove host-wide Docker prune operations. |
| `scripts/demo/demo-environment.ts`                                      | Restored the localhost/database allowlist required by the remaining Prisma seed entry point.                                                                                                  |

These are repository/local changes. Except for changes already merged by the
operator during the audit, the latest changes have not been deployed or verified
on EC2.

## 5. Secrets management and configuration

**PASS**

- `.env` and `deploy/.env.production` are ignored; only examples are tracked.
- No production secret value was printed. A tracked-file pattern scan found only
  test private-key literals.
- Browser-exposed configuration is limited to the Circle client key/URL and the
  public escrow address. Server signing keys are not named `NEXT_PUBLIC_*`.
- Session cookies are HTTP-only, `SameSite=Lax`, and secure in production.
- Logs redact credential-, authorization-, password-, private-key-, secret-, and
  token-shaped fields and bearer/credential text.

**FAIL / unresolved**

- The local production file reuses the Arc reconciliation bearer value for the
  ERPNext sync job. The new validator blocks this. An operator must rotate one
  side and update only its corresponding caller/route configuration.
- Private keys, database credentials, API credentials, and bearer secrets live
  in a plaintext env file on the deployment host and are injected as environment
  variables. File permissions, host access controls, backup exposure, process
  inspection, and secret-at-rest encryption were not verified.
- There is no managed secret store, automated rotation, expiry inventory, or
  documented emergency revocation evidence.
- SSH host-key fingerprint pinning is not configured in the deployment action.
- Base/runtime images use mutable tags rather than repository-pinned digests.

## 6. Circle, Arc, and USDC findings

- **PASS:** The application is explicitly an **Arc Testnet** deployment with
  chain ID `5042002`; schemas reject another chain ID. RPC URLs use HTTPS and
  addresses have EVM address validation. The public Circle client configuration
  contains no server private key.
- **PASS:** Repayment-agent validation requires escrow V3 when enabled, requires
  a correctly shaped agent key, requires it to differ from the borrow-authorizer
  key, and refuses payment when reconciliation is unhealthy.
- **PASS:** The live authenticated health endpoint reported Arc, Circle, and
  reconciliation healthy at audit time.
- **PARTIAL:** The configured USDC and escrow addresses were syntax-checked, but
  bytecode, proxy/admin ownership, contract source equivalence, Circle origin
  allowlisting, and the signer-to-authorizer relationship were not independently
  re-proven in this audit.
- **FAIL:** Server signers remain raw private keys in the host env file. This is
  acceptable only for a tightly controlled testnet pilot, not financial
  production.
- No mainnet endpoint/address was inferred, no contract was deployed, and no
  on-chain write was sent.

## 7. Frappe HR / ERPNext findings

- **PASS:** Production code rejects non-HTTPS, credential-bearing, queried,
  fragmented, loopback, private, link-local, multicast, and unsafe DNS-resolved
  ERPNext URLs. The local production override allowing loopback HTTP was disabled.
- **PASS:** Live dependency health reported ERPNext healthy. Scheduled sync uses
  an authenticated internal route; external internal-route ingress returned
  `404`.
- **PASS:** Employee sync credentials can be encrypted in PostgreSQL. Payroll
  credentials are server-only and malformed/absent credentials fail closed.
  The audited local production configuration had no payroll-specific credential,
  so salary-slip creation cannot run from that configuration.
- **PARTIAL:** Salary-slip support creates drafts only; it does not submit or
  cancel payroll documents. No payroll write was performed during this audit.
- **FAIL:** Prior live evidence records Frappe and ERPNext 17 development branches
  with HRMS 15.64.5/version-15, plus no Salary Structure Assignment or Salary
  Slip records. The branch mismatch remains unsupported.
- **BLOCKED:** The ERPNext API user's actual roles, doctype permissions, site
  identity, audit logs, and separation of demo/test employees from production
  were not available for independent verification. Live health alone does not
  establish least privilege or data-boundary correctness.

## 8. Security risks and unresolved issues

| Priority | Status      | Risk                                                                                                       | Required resolution                                                                                                                                  |
| -------- | ----------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | **FAIL**    | Raw Arc signing keys in a host env file                                                                    | Move signing to an approved managed custody/KMS/HSM architecture; document rotation and recovery; re-run authorization and transaction verification. |
| P0       | **FAIL**    | Reused Arc/ERPNext scheduler bearer secret                                                                 | Generate a new independent secret for one purpose, update the matching caller and route atomically, then run `npm run verify:production-env`.        |
| P0       | **BLOCKED** | No target-host backup restore or rollback demonstration                                                    | Restore a recent encrypted backup into an isolated target and execute a timed rollback drill without touching live funds.                            |
| P1       | **FAIL**    | Unsupported mixed ERPNext/Frappe/HRMS branches                                                             | Align supported release branches after a backed-up staging rehearsal and regression test.                                                            |
| P1       | **BLOCKED** | ERPNext least privilege and test-data boundary unproven                                                    | Export/redact role permissions and site identity; prove only required read and draft-create rights and production-only organization mappings.        |
| P1       | **PARTIAL** | SSH trust and image provenance                                                                             | Configure the SSH host fingerprint, pin base/Compose images by reviewed digest, and establish an update process.                                     |
| P1       | **PARTIAL** | Rollback tags exist but deployment has no automatic rollback                                               | Add a health-gated rollback procedure compatible with database migration rollback policy.                                                            |
| P2       | **PARTIAL** | Dependency policy accepts eight high-severity nodes mapped to two reviewed, currently unfixable advisories | Re-review on every lockfile/advisory change and replace or upgrade upstream dependencies when fixes become compatible.                               |
| P2       | **PARTIAL** | Operational alert webhook is optional                                                                      | Configure an independently monitored receiver and test active/recovered delivery without including sensitive payloads.                               |
| P2       | **PARTIAL** | Mock employer actions remain visible                                                                       | Keep explicit simulated labeling or disable the actions until a real, audited provider exists.                                                       |
| P3       | **PARTIAL** | Stale local demo commands/docs after demo-runner removal                                                   | Remove references or restore the isolated development tooling in a separate, tested cleanup.                                                         |

## 9. Verification commands and results

| Command / check                                      | Result                                                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                       | **PASS**                                                                                                                                                                                |
| `npm run typecheck`                                  | **PASS**                                                                                                                                                                                |
| `npm test`                                           | **PASS:** 82 files passed, 1 skipped; 524 tests passed, 1 skipped. An earlier concurrent build/test run caused one scrypt timeout; the focused test and the isolated full rerun passed. |
| `npm run build`                                      | **PASS:** Next.js production build and TypeScript completed; 36 static pages generated; sanitizer removed one standalone env file.                                                      |
| Standalone artifact inspection                       | **PASS:** no `.env*`, repository scripts, Prisma seed, Hardhat, or Vitest in `.next/standalone`.                                                                                        |
| `npm run prisma:validate`                            | **PASS**                                                                                                                                                                                |
| `npm run prisma:status`                              | **PASS (local DB):** all 57 migrations applied. Production DB status was not queried directly.                                                                                          |
| Fresh isolated migration replay (part of `npm test`) | **PASS:** all 57 migrations applied before tests; disposable DB removed.                                                                                                                |
| `docker compose ... config --quiet`                  | **PASS**                                                                                                                                                                                |
| `npm run verify:production-env`                      | **FAIL (expected blocker):** Arc and ERPNext scheduler secrets are reused.                                                                                                              |
| `npm run audit:dependencies`                         | **PARTIAL:** policy passed; eight high/critical nodes map to two explicitly reviewed unfixed advisories.                                                                                |
| Caddy container validation                           | **PASS:** `caddy validate` accepted the mounted configuration.                                                                                                                          |
| `docker compose ... build app`                       | **PASS:** the production runner image built successfully from the Docker context; no service was started.                                                                               |
| Tracked secret-pattern scan                          | **PASS with review:** matches were test-only private-key fixtures; ignored env files remain outside version control.                                                                    |
| CORS/debug scan                                      | **PASS:** no permissive CORS configuration; production dev funding is fail-closed; centralized logging redacts sensitive fields.                                                        |
| `https://qastfund.com/` and health probes            | **PASS at audit time:** root `200`, HTTP redirect `308`, live `200`, ready `200`, dependency unauthenticated `401`, internal route `404`; HSTS/CSP/frame/nosniff present.               |
| Authenticated live dependency GET                    | **PASS at audit time:** overall, Arc, Circle, ERPNext, and reconciliation all reported healthy. No body containing credentials or payroll data was recorded.                            |

The Docker production-image build exercised the real multi-stage build path and
completed successfully. No container or service was started from that image
during the audit.

## 10. Required manual deployment steps

1. Generate a new random bearer secret of at least 32 characters for **either**
   ERPNext sync or Arc reconciliation. Do not reuse any rate-limit, health,
   webhook, database, or agent secret. Update the single corresponding variable
   in `deploy/.env.production`; do not send the value through chat or commit it.
2. Confirm the env file is owned by the deployment account, readable only by
   that account, excluded from host backups unless backups are encrypted, and
   absent from shell history.
3. Run `npm run verify:production-env` and require a zero exit status.
4. Review the diff and merge the remaining hardening. Confirm the GitHub
   `production` environment has the intended reviewers and secrets. Add the EC2
   SSH host fingerprint to the SSH action configuration.
5. Run CI. Do not deploy unless lint, typecheck, tests, contract tests, migration
   replay, dependency policy, DR verification, and build all pass.
6. Back up PostgreSQL, verify the artifact checksum/encryption, and confirm the
   rollback image tags and operator command. Rehearse restore/rollback on an
   isolated target first.
7. Deploy the exact CI-tested SHA. Confirm migration status, container image
   IDs, non-root app/scheduler users, private network membership, and host
   firewall/security-group exposure.
8. Re-run edge probes. Confirm `/api/dev/**` and `/api/internal/**` return `404`,
   unauthenticated dependency health returns `401`, authenticated health is
   healthy, cookies are `Secure`/`HttpOnly`/`SameSite=Lax`, and Circle passkey
   origins work under the deployed CSP.
9. Review ERPNext site identity, supported app branches, API roles, audit logs,
   employee mappings, and absence of test payroll data. Do not create a salary
   slip as a connectivity test.
10. Before any real-value use, replace env-held signers with approved managed
    custody and complete a separately authorized, bounded transaction and
    reconciliation exercise.

## 11. Prioritized production-readiness checklist

### Must complete before the next deployment

- [ ] **P0:** Rotate the duplicated scheduler bearer and pass
      `npm run verify:production-env`.
- [ ] **P0:** Confirm no secret is present in tracked files or the built runtime
      image.
- [ ] **P1:** Merge and deploy the Caddy `/api/dev/**` denial and CI/CD hardening.
- [x] **P1:** Record a successful Docker production-image build for the audited tree.
- [ ] **P1:** Pin/verify the deployment SSH host fingerprint.

### Must complete before a controlled external pilot

- [ ] Demonstrate target-host backup restore and application rollback.
- [ ] Verify ERPNext site identity, supported branches, least-privilege roles,
      and production/test data isolation.
- [ ] Re-prove Arc contract bytecode/configuration, signer authorization,
      Circle origin settings, and reconciliation from read-only evidence.
- [ ] Configure and test external operational alert delivery.
- [ ] Capture deployed session-cookie flags and container/network/firewall state.

### Must complete before financial production

- [ ] Move all transaction signing out of plaintext environment variables into
      approved managed custody with policy, rotation, recovery, and audit evidence.
- [ ] Complete legal/compliance, lending, privacy, payroll, and incident-response
      approvals outside this repository audit.
- [ ] Perform an explicitly authorized bounded-value end-to-end transaction,
      receipt, ledger, and reconciliation verification on the intended network.
- [ ] Close or formally accept all P0/P1 findings with named owners and dates.

Until every financial-production item is complete, the honest designation is
**controlled Arc Testnet pilot only**.
