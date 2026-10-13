# QastFund controlled-pilot readiness

Audit date: 2026-10-12 (Asia/Karachi)  
Evidence freeze: 2026-10-12 22:11 PKT  
Milestone deadline: 2026-10-15  
Scope: repository, local PostgreSQL, local-chain fixtures, checked-in deployment
configuration, and read-only Arc Testnet/ERPNext readiness probes.

## Final technical pilot acceptance

Decision recorded: 2026-10-13 (Asia/Karachi).

**GO for the existing two-user, test-fund-only Arc Testnet validation pilot.
NO-GO for external/public lending and production financial operations.**

The project has demonstrated the documented end-to-end lending lifecycle,
passed the recorded automated and integration checks, and completed the Arc
Testnet and ERPNext audits. Public HTTPS and application access-control checks
have also been performed, with the remaining deployment and operational
limitations recorded below.

This acceptance is limited to the existing controlled validation scope. It is
not a production security certification, regulatory approval, or authorization
to conduct public or real-money lending. It does not expand the participant
allowlist, permitted assets, network, transaction limits, or operating
procedures defined by this document.

Before any broader release, QastFund must address signer custody and rotation,
complete target-host backup/restore and rollback verification, validate the
applicable Circle origin/callback configuration, and obtain appropriate
independent security, legal, and privacy assurance.

## Recommendation

**Technical GO for the existing two-user, test-fund-only Arc Testnet validation
pilot. NO-GO for an external/user-facing controlled pilot and NO-GO for
production.**

On 2026-10-12, bounded reconciliation caught up to finalized head and applied
the five previously missing events with no unmatched or conflicting events. A
fresh scheduled ERPNext synchronization completed successfully, both monitored
job heartbeats recovered, the Arc and ERPNext audits passed, and preflight
returned `READY FOR CONTROLLED ARC TESTNET PILOT`. This narrowly scoped GO does
not authorize new participants, production assets, or public launch.

The public production edge is available over HTTPS: on 2026-10-12,
`https://qastfund.com/` returned `200`, `http://qastfund.com/` returned a `308`
redirect to HTTPS, and `https://qastfund.com/api/health` returned `200` through
Caddy. This verifies client-to-edge transport for those exact endpoints at the
time observed; it does not independently establish the deployed Caddy-to-app
path, internal service transport/isolation, administrative ingress, secure
cookie behavior, or Circle relying-party/origin settings. Legal, lending,
privacy, external contract-security, key-custody, Circle recovery, and
target-host rollback exercises remain unevidenced, so the mandatory external
release gate remains closed.

No production deployment, contract deployment, fund movement, forced ledger
correction, or historical-record rewrite was performed during this audit.

### Milestone 3 current-state addendum — 2026-10-13

The accepted scope above is unchanged, but the gate for performing a new live
Arc action is currently closed. A fresh read-only preflight at Arc block
`66982613` passed environment, chain, RPC, Circle, wallet ownership/balances,
ERPNext, rate-limit, signer, escrow, and database checks, but returned
`NOT READY FOR PILOT` because the persisted reconciliation cursor is stale. No
catch-up was run simply to obtain a passing result. An authorized operator must
review the database-writing behavior of `npm run reconcile:arc`, perform a
bounded catch-up, and rerun `npm run audit:arc` plus
`npm run pilot:preflight` before a live transaction demo. The read-only frozen
evidence walkthrough remains available.

Milestone 3 also verified the combined local workflow and repaired two demo
gaps: the idempotent development seed now includes repayment plans,
installments, allocations, ERPNext employee mappings, a payroll proposal, and a
partial-payment delinquency case; and the lender page now separates pending,
approved-but-not-reserved, reserved, disbursed, repaid, and outstanding amounts
with repayment history. The seed was run twice against a disposable 53-migration database and
the database was removed afterward; the configured database was not reset or
reseeded.

Current verification results: 434 application tests passed and one opt-in DR
test was skipped across 71 files; focused changed-path tests passed 33/33;
contract tests passed 29/29; the disposable local-chain lifecycle passed 2/2;
borrowing, repayment, and ledger verification scripts passed; typecheck, lint,
formatting, Prisma validation/status (53 migrations), and the 35-page
production build passed. ERPNext audit passed (3/3 matched, no review records)
and Arc audit passed (3 offers, 3 loans, 8 receipts, no journal problems or
stale intents). Authenticated HTTP route/API checks passed, but interactive
browser UI behavior was not exercised in this tool session and still requires
the presenter dry-run documented in `DEMONSTRATION_RUNBOOK.md`.

## Verified completed work

- The modular Next.js/PostgreSQL application has tenant-scoped authentication,
  active-membership and role checks, trusted-origin validation, Zod request
  validation, database-backed rate limiting, secure session cookies, and
  server-side authorization for financial routes.
- ERPNext employee-directory configuration, encrypted credential storage,
  manual/scheduled synchronization, lifecycle status enforcement, invitation
  handling, stale-run recovery, and health reporting are implemented.
- Circle modular-wallet enrollment binds a unique Arc Testnet address to a
  user through a consumed ownership challenge. Browser configuration targets
  Circle's Arc Testnet transport and server validation fixes the chain to
  `5042002`.
- Arc configuration matches the intended test environment: chain ID `5042002`,
  RPC `https://rpc.testnet.arc.io`, canonical USDC
  `0x3600000000000000000000000000000000000000`, escrow
  `0x46c4a0a877e6967542078A580468b80195c466cC`, reconciliation start block
  `66108453`, and five confirmations. The preflight verified deployment
  receipt, escrow/USDC binding, and equality of the configured, derived, and
  on-chain authorization signer addresses.
- Borrow authorization is a five-minute, server-signed EIP-712 message bound
  to chain, escrow, offer, borrower wallet, expiry, and one-time authorization
  ID. The private key is server-only and ignored environment files are not
  tracked. The contract signer is immutable; rotation requires a replacement
  escrow and a controlled wind-down/migration plan.
- Offer funding, acceptance/disbursement, repayment, transaction-intent
  idempotency, receipt/event validation, finalized-event reconciliation,
  duplicate detection, reorg-window replay, cursor leases, unmatched/conflict
  preservation, alerts, and recovery procedures are implemented.
- Financial records use integer units. Database constraints protect positive
  amounts, offer capacity, loan terms, lifecycle ordering, canonical chain
  identifiers, and repayment submission uniqueness. Ledger transactions and
  entries are immutable by application convention and checked for balance.
- Backup/restore tooling was demonstrated against disposable PostgreSQL 17.11
  databases: all 45 migrations applied, a 161,294-byte logical backup was
  validated and restored, the reconciliation cursor resumed, and four restored
  reconciliation/DR tests passed. Disposable databases were removed.

## Changes made in this readiness pass

1. Replaced the provisional weighted origination scorer with
   `loan-decision-manual-review-v1`. It never calculates a score, burden limit,
   or automatic approval. It records `score: null`, evidence references,
   reasons, policy version, timestamps, and auditable review history.
2. Preserved server-side hard gates for invalid terms, inactive employment,
   employer/product loan limits, and outstanding-principal limits. Missing or
   unverified income and unavailable tenure return `REVIEW_REQUIRED`.
3. Disabled authorization from historical `APPROVAL_CONSIDERATION` records.
   Only a current `REVIEW_REQUIRED` decision with one permitted employer-admin
   approval can authorize signing; identity, freshness, consistency, and other
   mandatory failures remain non-overridable.
4. Expanded the local-chain end-to-end regression to perform controlled
   ERPNext-style employee synchronization, employee accounts and wallets,
   application, real decision persistence, employer approval, signed
   acceptance, disbursement, repayment, and database/on-chain verification.
5. Fixed a lifecycle defect exposed by that regression: a chain block's
   second-precision start time could precede a millisecond-precision human
   approval and violate `Loan_lifecycle_order_check`. Application activation
   now clamps to the latest request/approval milestone while retaining the
   exact on-chain timestamp separately.
6. Applied the two repository migrations that were pending in the configured
   local development database: `20261012120000_financial_invariants` and
   `20261012150000_operational_incidents`. This was local schema alignment, not
   a production migration.
7. Corrected the Arc pilot preflight's read-only boundary. Its reconciliation
   health check previously reused the dependency-health path that can persist
   incident transitions and deliver alert webhooks. Preflight now selects an
   explicit read-only mode; the live dependency-health endpoint retains its
   existing observe-and-record behavior. A regression test proves both modes.
8. Corrected the deployment transport finding. The earlier HTTP-only statement
   came from the tracked example defaults (`SITE_ADDRESS=:80` and a placeholder
   HTTP `APP_URL`), not a live observation. The current local deployment file
   identifies `APP_URL=https://qastfund.com` and `SITE_ADDRESS=qastfund.com`;
   the public root and health route were observed over HTTPS as described
   above. The internal/backend transport boundary remains to be verified on the
   target host.

## Regression coverage

The controlled fixtures do not use customer funds. Local-chain tests deploy a
disposable escrow and mock USDC.

| Required condition                            | Evidence                                                                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ERPNext sync through repayment/reconciliation | Enhanced `tests/p2p-lending-local-e2e.test.ts` covers sync, accounts, wallets, application, decision, approval, disbursement, repayment, DB state, contract state, balances, and empty escrow. |
| Eligible/ineligible employees                 | Decision, eligibility, directory, and on-chain organization tests cover active and hard-gate failures.                                                                                         |
| Inactive/suspended/departed employees         | Directory lifecycle and on-chain organization tests cover inactive, suspended, terminated/deactivated, and former-employee sections.                                                           |
| Missing/unverified attributes                 | Origination tests cover unavailable, unverified, stale, and invalid income; unavailable tenure; unresolved identity; stale sources; and conflicting finance records.                           |
| Duplicate applications/requests               | Partial unique indexes plus borrow, repayment, intent-concurrency, rate-limit, and persistence idempotency tests.                                                                              |
| Unauthorized approval/signing                 | Role/tenant tests, employee self-review rejection, hard-gate override rejection, exact signer checks, and contract authorization replay tests.                                                 |
| Insufficient balances/failed transactions     | Pilot-readiness balance checks, funding/repayment checks, reverted-receipt tests, and contract tests.                                                                                          |
| RPC timeout/uncertain result                  | Reconciliation retry/exhaustion tests and borrow/repayment pending-transaction tests; no submission is marked successful on request alone.                                                     |
| Duplicate/delayed/out-of-order events         | Reconciliation tests cover duplicate, missed, delayed dependency, out-of-order, reorged, unmatched, and conflicting events.                                                                    |
| Repeated repayment                            | Repayment request keys, submission-hash uniqueness, intent concurrency, and finalized-event idempotency tests.                                                                                 |
| Restart/recovery                              | Persistent cursor/lease tests, worker restart tests, reconciliation alert recovery, stale ERP run recovery, and real backup/restore verification.                                              |
| Partial failures/safe retries                 | ERP partial/failure recovery, email retry state, transaction ambiguity, database-after-chain recovery, and bounded reconciliation retry tests.                                                 |
| Read-only preflight                           | `tests/dependency-health-read-only.test.ts` proves preflight observation cannot record signals/incidents or create an alert sender while the default health path still can.                    |

Remaining test limitations: Arc negative paths were simulated locally rather
than induced with shared testnet funds; Circle account recovery was not tested;
there is no load/soak test; and the disaster-recovery test remains skipped in
the ordinary suite unless explicitly enabled or invoked by `dr:verify`.

## Commands and actual results

| Command                                                                                            | Actual result                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` before schema alignment                                                                 | **FAIL** — 419 passed, 9 failed, 1 skipped. All failures traced to two unapplied migrations; local-chain repayment could not read the missing repayment column. |
| `npm run prisma:status` before alignment                                                           | **FAIL** — 45 migrations found; two pending.                                                                                                                    |
| `npm run prisma:deploy`                                                                            | **PASS** — the two pending migrations applied to the configured local development database.                                                                     |
| `npm test` after alignment, before this code change                                                | **PASS** — 428 passed, 1 skipped across 68 files.                                                                                                               |
| Targeted changed-path tests                                                                        | **PASS** — decision/persistence/concurrency suites passed; enhanced local lifecycle and on-chain timestamp tests passed (17/17 in the final targeted run).      |
| Final `npm test`                                                                                   | **PASS** — 68 files and 415 tests passed; 1 file/test skipped because real DR mode is opt-in.                                                                   |
| Initial preflight-regression test attempts                                                         | **FAIL (test harness)** — Vitest mock hoisting, then an incomplete partial `viem` mock; both setup defects were corrected without weakening assertions.         |
| Preflight read-only-mode regression                                                                | **PASS** — 1 file, 2 tests; read-only mode suppressed signals, incidents, and alert delivery, while default recording behavior remained enabled.                |
| `npm run test:contracts`                                                                           | **PASS** — 23 Solidity tests passed.                                                                                                                            |
| `npm run typecheck`                                                                                | **PASS** — Hardhat compile, Next.js 16.4 route type generation, and `tsc --noEmit`.                                                                             |
| `npm run lint`                                                                                     | **PASS**.                                                                                                                                                       |
| `npm run format:check`                                                                             | **PASS**.                                                                                                                                                       |
| `npm run build`                                                                                    | **PASS** — optimized Next.js 16.4 production build and 33 static pages completed.                                                                               |
| `npm run prisma:validate`                                                                          | **PASS**.                                                                                                                                                       |
| Final `npm run prisma:status`                                                                      | **PASS** — 45 migrations; configured local database is up to date.                                                                                              |
| `node --env-file=.env scripts/database/verify-disaster-recovery.mjs` with Compose PostgreSQL tools | **PASS** — 45 migrations, verified backup/restore, cursor resume, four restored-database tests.                                                                 |
| Initial `npm run audit:erpnext`                                                                    | **FAIL** — the last complete sync was stale.                                                                                                                    |
| Scheduled ERPNext recovery                                                                         | **PASS** — 1 considered, 1 succeeded, 3/3 employees matched, no review/error/invitation failure.                                                                |
| Final `npm run audit:erpnext`                                                                      | **PASS** — 1/1 enabled integration complete and fresh.                                                                                                          |
| Earlier bounded `npm run reconcile:arc` catch-up                                                   | **PASS** — backlog reduced to zero; five missing finalized events applied; zero unmatched/conflicting events.                                                   |
| Final `npm run audit:arc`                                                                          | **PASS** — 3 offers, 3 loans, 8 receipts, zero journal problems and zero stale intents.                                                                         |
| Monitored scheduler endpoint recovery                                                              | **PASS** — authenticated Arc and ERPNext runs returned 200 and persisted healthy job heartbeats.                                                                |
| Read-only `npm run pilot:preflight` before final catch-up                                          | **FAIL / NOT READY** — all other checks passed, but the persisted reconciliation cursor was stale. No incident or webhook state was changed.                    |
| Final bounded `npm run reconcile:arc` catch-up                                                     | **PASS** — 2 ranges, 1,392 starting backlog blocks, 0 events observed/applied, 0 unmatched/conflicts, 0 remaining backlog; cursor advanced to `66850604`.       |
| Final read-only `npm run pilot:preflight`                                                          | **PASS / READY** — every technical check passed at Arc block `66850636`; the command performed no reconciliation, incident, webhook, or financial mutation.     |
| Public edge transport probes                                                                       | **PASS** — `https://qastfund.com/` returned `200`; plain HTTP returned `308` to HTTPS; `https://qastfund.com/api/health` returned `200` through Caddy.          |
| TLS handshake to `qastfund.com:443`                                                                | **PASS** — TLS 1.2/AES-128; certificate subject `CN=qastfund.com`, issued by Let's Encrypt, valid from 2026-10-12 through 2027-01-10 UTC.                       |
| External TCP probes from the audit workstation                                                     | **PASS, bounded** — `13.235.69.220`: ports 80/443 accepted connections; Caddy admin 2019, application 3000, and PostgreSQL 5432 timed out.                      |
| Public authorization probes                                                                        | **PASS, bounded** — `/employer` redirected to `/sign-in`; unauthenticated `/api/employer/loan-decisions` returned `401`.                                        |
| Focused auth/origin/scheduler route tests                                                          | **PASS** — 5 files, 18 tests covering role checks, trusted origins, and scheduler bearer authorization.                                                         |
| Authorizer secret consistency check                                                                | **PASS, local deployment file only** — key exists, has the expected format, and derives the documented immutable contract signer; no secret was printed.        |
| Backup/restore script syntax                                                                       | **PASS** — `node --check` passed for backup, restore, disposable DR verification, and PostgreSQL tooling scripts.                                               |
| Focused recovery-tool tests                                                                        | **PASS/PARTIAL** — 3 tests passed; the real restored-database test was skipped because `DR_RESTORE_VERIFICATION` was not enabled.                               |

A passing technical preflight does not override the external release gates.

## Final acceptance evidence freeze

### Exact permitted pilot scope

GO is limited to the two already verified users and their two distinct Circle
wallets, the existing deployed Arc Testnet escrow, and operator-controlled
testnet funds. Existing per-loan/policy limits, manual employer review, current
authorization signer, reconciliation monitoring, and the documented passkey
transaction boundaries remain mandatory. This GO does not authorize additional
participants or organizations, production assets, public lending, contract
deployment/replacement, signer rotation, or production financial operations.

### Live topology and ingress

- At 2026-10-12 22:09 PKT, narrow TCP probes from the audit workstation found
  only ports 80 and 443 reachable at `13.235.69.220`. Ports 2019, 3000, and
  5432 timed out. This supports, but cannot prove from every network location,
  that Caddy admin, Next.js, and PostgreSQL are not directly Internet-exposed.
- The checked-in Compose topology publishes only Caddy ports 80/443. PostgreSQL
  and the reconciliation scheduler attach only to the `internal` network; the
  application attaches to `internal` and `web`; Caddy attaches to `web`. Caddy
  proxies to `app:3000`, and scheduler calls use `http://app:3000` inside the
  Docker network.
- The target host's listening sockets, container bindings, firewall/security
  group, Docker network membership, and direct-host bypass paths were not
  inspected. A target-host operator must retain sanitized `docker compose ps`,
  network inspection, listening-socket, and firewall/security-group evidence.
- The checked-in Caddy configuration now returns `404` for `/api/internal/*`
  at the public edge. Application code still requires dedicated bearer secrets
  with constant-time comparison before either job runs. The scheduler reaches
  those routes directly over the private Docker network. This configuration
  has validated locally but has not been deployed or verified on the target
  host during this milestone.

### Session, administrative, and Circle controls

- Session-cookie code sets `HttpOnly`, `SameSite=Lax`, root path, expiry, and
  `Secure` when `NODE_ENV=production`; the production image sets
  `NODE_ENV=production`. State-changing routes use exact-origin checks against
  `APP_URL`, and financial/administrative handlers resolve server-side sessions
  and organization roles.
- Live unauthenticated checks confirmed the employer page redirects to sign-in
  and the employer loan-decision API returns `401`. An authenticated production
  `Set-Cookie` capture was not performed, so the actual deployed cookie flags
  remain unverified.
- The dependency-health route now requires a dedicated constant-time bearer
  secret. Authenticated `GET` is read-only; authenticated `POST` is the explicit
  observe-and-record surface for incident transitions and alert delivery.
  Missing/invalid credentials receive a sanitized `401` before dependency
  inspection. The checked-in change passed focused tests but is not evidence
  that the currently deployed public route has changed.
- The checked-in Caddy configuration now adds HSTS, `X-Frame-Options: DENY`,
  and a narrow CSP covering base URI, form actions, and frame ancestors. Caddy
  validation passed locally. The headers have not been deployed or recaptured
  from the public site, and any broader CSP still needs Circle SDK compatibility
  testing.
- The application requires a secure browser context for passkeys and the live
  Circle/Arc binding tests passed. The exact production relying-party/origin,
  callback allowlist, account-recovery policy, and client-key restrictions live
  in Circle and were not independently inspected. Console evidence remains
  required.

### Signer custody and rotation

- The authorizer key is server-only in code, ignored by git, and its derived
  address matches the documented immutable contract signer. No key or secret
  value was printed during this audit.
- The inspected local `deploy/.env.production` stores the authorizer as a
  plaintext environment-file value. Its ACL grants modify access to multiple
  local principals. This is not evidence of managed KMS/HSM custody, target-host
  access logging, least privilege, backup, or compromise detection.
- The escrow signer is immutable. Rotation requires a replacement escrow,
  explicit handling/wind-down of existing offers and loans, application
  configuration migration, and a separately authorized testnet transaction.
  No rotation or compromise-response rehearsal is evidenced. Do not rotate or
  redeploy during this evidence freeze.

### Backup, restore, rollback, and reconciliation

- Backup tooling creates a PostgreSQL custom-format dump, validates its table
  of contents, and writes a SHA-256 sidecar. Credentials are passed through the
  child environment and command output is redacted.
- Restore validates the checksum and requires
  `RESTORE_CONFIRM_DATABASE` to exactly match the target database name. It then
  deliberately drops and recreates the target `public` schema; it must never be
  pointed at the live database during routine verification.
- The disposable PostgreSQL restore proof remains valid repository evidence:
  migrations, backup/checksum, separate restore, cursor recovery, and
  idempotent reconciliation passed. It was repeated on 2026-10-13 using two
  disposable databases: all 53 migrations applied, a 203,711-byte custom dump
  was checksummed and validated, restore recovered cursor `4243:4237:4242`,
  4/4 recovery/reconciliation tests passed, and both databases were dropped.
- No target-host backup inventory, encrypted off-host retention, WAL/PITR state,
  restoration credentials, measured RPO/RTO, pinned previous application image,
  target rollback, or post-restore Arc replay was verified. These require
  operator evidence and a dedicated recovery window with user traffic and
  transaction submission disabled.
- Bounded reconciliation and read-only Arc audit evidence are current for the
  existing testnet records. Reconciliation does not replace backups for users,
  tenant ownership, policies, wallet bindings, or intent history.

### Controls safely verifiable before 2026-10-15

- Retain the external port/HTTPS/authorization probe output and the sanitized
  Compose/network configuration evidence.
- Have a target-host operator capture listening sockets, published container
  ports, firewall/security-group rules, scheduler status, and recent sanitized
  logs without restarting services.
- Capture an authenticated pilot login response showing actual session-cookie
  flags, without sharing the cookie value.
- Export Circle Console evidence for exact allowed origin/relying-party,
  callback settings, client-key restrictions, and recovery policy.
- Record the secret-store location and access-control review without exporting
  the authorizer key; record whether the local plaintext file is only a staging
  copy and remove it through an approved secret-management procedure later.
- Inventory existing production backups and provider PITR/retention status;
  validate checksums and metadata without restoring over live data.

### Controls requiring external assurance or a recovery window

- Independent Solidity/application penetration and dependency security review.
- Jurisdiction-specific lending, privacy, consent, retention, complaints, and
  servicing approval.
- Managed signer custody evidence and a rehearsed immutable-signer replacement
  and old-escrow wind-down plan.
- A timed restore into isolated production-like infrastructure, application
  rollback to a pinned prior artifact, Arc replay, discrepancy review, and
  measured RPO/RTO before traffic is restored.

### Milestone 4 verification — 2026-10-13 20:57 PKT

- Security-focused Vitest run: 39/39 passed across 8 files.
- Complete application regression: 442 passed, 1 skipped across 73 files.
- Contract regression after the safe lockfile update: 29/29 passed.
- Typecheck, ESLint, Prettier check, Prisma validation/status, and the Next.js
  production build passed. Prisma reported 53 migrations and an up-to-date
  local schema.
- Production Compose interpolation passed. Caddy validation passed with the
  production-supplied `SITE_ADDRESS` variable.
- The isolated disaster-recovery verification passed as described above. It
  did not access or overwrite live data.
- Non-forcing `npm audit fix` removed the remediable `source-map-js` and
  Hardhat/elliptic findings. `npm audit` still reports 9 high-severity
  transitive findings in the Next ESLint and Prisma CLI toolchains (4 shown by
  `--omit=dev`). The automated remedy proposes breaking Next/Prisma downgrades,
  so it was not applied.

### Milestone 6 final validation — 2026-10-13 21:29 PKT

- Local readiness, employee/admin authentication, principal employee/employer
  pages and APIs passed. An employee request for an employer payroll page was
  redirected to `/app`.
- The fresh read-only ERPNext audit passed with a successful scheduled run,
  3/3 active source mappings matched, and no review diagnostics. The fresh Arc
  audit passed with 3 offers, 3 loans, 8 verified receipts, zero journal
  problems, and zero stale intents. Circle/Arc configuration tests passed 2/2.
- Fresh preflight reached Arc Testnet and passed chain, token, contract, signer,
  Circle, wallet, ERPNext, rate-limit, and database checks, but ended `NOT READY
FOR PILOT` because reconciliation health is stale. No catch-up was run.
- The final isolated application suite passed 447 tests with 1 intentional skip
  across 74 files. Contract tests passed 29/29 and local-chain lifecycle tests
  passed 2/2. Typecheck, lint, formatting, Prisma validation/status, and the
  production build passed.
- The documented disaster-recovery command was corrected to load `.env` and to
  run restored-database tests directly against its already-isolated restore
  target. The final verification applied 53 migrations, created and validated
  a 204,072-byte backup, restored cursor `4243:4237:4242`, passed 4/4 recovery
  tests, and dropped both disposable databases.
- Public HTTPS returned `200`, HTTP redirected with `308`, and TLS validation
  succeeded. Ports 2019, 3000, and 5432 did not accept the narrow probes.
  However, the live deployment still returned `200` for unauthenticated
  dependency health and `405` for the internal reconciliation route, and did
  not return the new HSTS/CSP/frame headers. This proves that the checked-in
  health-route/Caddy hardening has not yet been deployed.

## Submission evidence index

| Evidence                            | Location or command                                                                                     | Frozen result                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Submission overview                 | `../README.md`; `SUBMISSION_SUMMARY.md`                                                                 | Scope, solution, results, limitations, and roadmap packaged                                                              |
| Architecture and demo               | `ARCHITECTURE.md`; `DEMONSTRATION_RUNBOOK.md`; `LOAN_ORIGINATION_V1.md`                                 | Current boundaries, workflow, abort rules, and fallback                                                                  |
| Historical live lifecycle           | `ARC_TESTNET_PILOT_REPORT.md`                                                                           | Recorded offer, disbursement, repayment, and receipt evidence                                                            |
| Acceptance decision and gate matrix | This document: Final technical pilot acceptance and Controlled-pilot release gate                       | Narrow technical GO; broader NO-GO                                                                                       |
| Automated application regression    | `npm test`                                                                                              | Current: 447 passed, 1 skipped across 74 files in a disposable migrated database                                         |
| Contract and local lifecycle        | `npm run test:contracts`; `npm run chain:test`                                                          | Current: 29/29 and 2/2 passed                                                                                            |
| Live Circle/Arc binding             | `npm run test:arc-live`                                                                                 | 2/2 passed                                                                                                               |
| Arc receipt/journal integrity       | `npm run audit:arc`                                                                                     | 3 offers, 3 loans, 8 receipts; zero journal/stale-intent issues                                                          |
| ERPNext readiness                   | `npm run audit:erpnext`                                                                                 | 3/3 matched; fresh scheduled success; zero review records                                                                |
| Technical preflight                 | `npm run pilot:preflight`                                                                               | Frozen READY; current NO-GO until stale cursor is caught up                                                              |
| Milestone 3 local demo seed         | disposable 53-migration database; `prisma/seed.ts` run twice                                            | Plans/payroll/delinquency data created idempotently; DB removed                                                          |
| Authenticated application surfaces  | local HTTP employee/employer pages and list APIs                                                        | `200`; interactive browser dry-run still required                                                                        |
| Public transport and exposure       | HTTPS/redirect/health plus narrow TCP probes to `13.235.69.220`                                         | 80/443 reachable; 2019/3000/5432 timed out                                                                               |
| Auth/origin/scheduler controls      | Focused authorization, origin, dependency-health, and payroll-operation tests                           | 20/20 passed during hardening; final regression listed below                                                             |
| Session security implementation     | `session-cookie.ts`, production Dockerfile, request-origin guard                                        | Source/config pass; deployed cookie capture pending                                                                      |
| Signer consistency and custody      | Secret-safe derived-address check; `BORROW_AUTHORIZATION.md`                                            | Address match; managed custody/rotation rehearsal pending                                                                |
| Recovery                            | `npm run dr:verify` equivalent with Docker PostgreSQL tools; `DATABASE_BACKUP_AND_DISASTER_RECOVERY.md` | 53 migrations, backup/checksum, isolated restore, cursor recovery, and 4/4 tests passed; target restore/rollback pending |
| Operational metadata hardening      | `/api/health/dependencies`, route tests, Caddy configuration                                            | Bearer protected; read-only GET; recording POST; deployment pending                                                      |

## Security and operational findings

### Critical — recovered on 2026-10-12

- Arc reconciliation caught up from the stale cursor through a bounded replay.
  Five finalized events were applied from canonical receipts; no financial
  record was fabricated or silently rewritten. The final Arc audit reports no
  journal problem or stale intent.
- ERPNext completed a fresh `SCHEDULED/SUCCESS` run with all three records
  matched and no review or error. Authenticated Arc and ERPNext monitored-job
  runs persisted healthy heartbeats. Preflight marked all four critical
  operational incidents recovered.

### High — unresolved

- **Independent assurance is absent.** No external Solidity audit,
  penetration test, dependency security review, legal lending review, privacy
  review, or jurisdiction-specific compliance approval is evidenced.
- **Signing-key custody/rotation is operationally incomplete.** The repository
  documents managed storage, but the inspected local deployment file holds a
  plaintext key and has multiple modifying principals. Target KMS/HSM or secret
  store custody, access logging/review, backup, compromise detection, and an
  immutable-signer replacement rehearsal are not evidenced.
- **Target recovery and rollback are not demonstrated.** Disposable restore
  testing passed, but no target backup inventory/PITR evidence, isolated
  production-like restore, pinned prior application artifact, rollback,
  post-restore Arc replay, or measured RPO/RTO is available.

### Medium — unresolved

- External probes found only 80/443 reachable and the Compose topology isolates
  application/data ports, but target-host sockets, container bindings, firewall
  rules, and direct-host bypass paths were not inspected.
- Deployed session-cookie flags were not captured through an authenticated
  pilot login. Circle production origin/relying-party, callback allowlist,
  client-key restrictions, and recovery settings remain external evidence.
- The dependency-health and Caddy hardening is checked in and locally verified,
  but production has not been changed. An operator must set the dedicated
  secret, update monitoring clients, deploy the application/Caddy configuration,
  and capture external `401`/`404` plus authenticated-health evidence.
- Escrow has no pause/rescue mechanism and signer rotation requires
  redeployment. Lender cancellation exists on chain but has no application
  flow; `OfferCancelled` is not reconciled. Application `DEFAULTED` has no
  equivalent contract transition.
- Target-host scheduler deployment, stale/recovery alert delivery, application
  rollback, and post-restore Arc replay have not been observed as one exercise.
- Audit-log writes are append-only by application convention, but no database
  trigger or restricted database role preventing update/delete was verified.
- The read-only Arc audit is capped at 500 records per category without
  pagination or a fail-on-overflow control.
- Employer/employee consent, data retention/deletion, support ownership,
  escalation contacts, pilot participant limits, and loss/complaint handling
  are not fully approved operational artifacts.
- `npm audit` retains 9 high-severity transitive toolchain findings. The offered
  forced remediation is a breaking downgrade of Next/Prisma; adopt an upstream-
  compatible patched release after regression review rather than forcing it
  into this evidence freeze.

### Low / defense in depth

- The checked-in baseline CSP, HSTS, and frame-denial headers require production
  deployment and capture. A more restrictive CSP requires Circle compatibility
  testing before adoption.
- PostgreSQL emits a `pg` deprecation warning when tests overlap queries; this
  is not a current functional failure but should be removed before upgrading
  to `pg` 9.

No secret value was copied into this report. `.env` and
`deploy/.env.production` are ignored; only example files are tracked.

## Controlled-pilot release gate

| Mandatory gate                                                 | Evidence                                                                                                                        | Gate         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1. End-to-end regression passes                                | Local controlled regression and final full suite pass. Arc negative paths remain simulated locally.                             | PASS locally |
| 2. No unmitigated critical/high defects                        | Public edge/topology probes passed; independent assurance, signer custody, and target recovery remain high risks.               | **FAIL**     |
| 3. Decisions and approvals auditable                           | Versioned immutable decision/review records and audit events; tests cover role/tenant/idempotency.                              | PASS locally |
| 4. Unauthorized/duplicate transactions blocked                 | Server, database, contract, and reconciliation controls with regression coverage.                                               | PASS locally |
| 5. Ledger/on-chain reconciliation demonstrated                 | Cursor caught up; five missing events recovered; 8/8 receipts audited with zero journal problems or stale intents.              | PASS         |
| 6. Backup/recovery/incident procedures tested                  | Disposable DB backup/restore passed; target backup inventory, rollback, timed restore, and chain replay were not exercised.     | **FAIL**     |
| 7. Employer onboarding/employee consent documented             | Technical onboarding exists; approved consent/retention procedure is not evidenced.                                             | **FAIL**     |
| 8. Legal/lending/privacy obligations reviewed                  | No approved external review in repository.                                                                                      | **FAIL**     |
| 9. Pilot limits/responsibilities/support/escalation documented | Financial policy is configurable; approved pilot cap, named owners, contacts, SLA, complaints and loss handling are incomplete. | **FAIL**     |
| 10. Deployment/rollback reviewed                               | Public ports and Compose isolation passed bounded review; host-local topology and rollback/restore remain unverified.           | **FAIL**     |

## Remaining implementation and operational tasks

1. Keep the existing internal Arc Testnet validation pilot limited to the two
   verified wallets and test funds while monitoring cursor and ERP freshness.
2. Deploy/observe the scheduler continuously through a service restart and
   retain external alert-delivery recovery evidence.
3. Complete target-host listening-port/firewall inspection, authenticated
   secure-cookie capture, dependency-health/internal-route ingress decision,
   and Circle origin/relying-party verification for `https://qastfund.com`.
   Retain sanitized evidence.
4. Complete independent contract/application security and dependency review;
   document managed signer custody, access, backup, rotation, and compromise
   response.
5. Obtain jurisdiction-specific legal, lending, privacy, consent, retention,
   complaints, and servicing approval. Record accountable owners and dates.
6. Approve explicit pilot limits: organizations/users, per-loan and aggregate
   exposure, allowed duration, testnet-only asset policy, support hours,
   escalation contacts, pause criteria, and loss responsibility.
7. Add `OfferCancelled` application/reconciliation support and explicit audit
   overflow handling before scale exceeds current bounded assumptions.
8. In a dedicated recovery window, restore into isolated production-like
   infrastructure, roll back to a pinned prior application artifact, replay
   Arc, measure RPO/RTO, and rerun every gate. Never restore over live data for
   a rehearsal.

## Dependencies and assumptions

- Arc Testnet is validation infrastructure, not proof of production security,
  finality policy, availability, or regulatory fitness.
- The 2026-10-12 live probes establish current public DNS and client-to-edge TLS
  only. Circle console origin/passkey/recovery settings, internal target-host
  transport/isolation, ERPNext availability, SMTP, managed secret storage,
  alert delivery, host backups, and legal approvals remain external
  dependencies that source code cannot prove.
- Current loans are single-maturity bullet obligations in USD/USDC. No
  installment affordability or multi-currency policy is approved.
- Automatic approval remains blocked until verified income and employment
  start-date evidence, approved thresholds, representative data, fairness
  review, and an explicit activation decision exist.

## Next recommended action

Proceed only with the existing two-user, test-fund-only Arc Testnet validation
pilot. The fastest path to an external pilot GO is to verify the deployed
internal topology, secure-session behavior, and final Circle origin; retain a
target-host scheduler restart/alert recovery and rollback/restore rehearsal;
then obtain named legal/privacy and independent security approvals. Do not
expand participants or introduce production assets before those gates pass.
