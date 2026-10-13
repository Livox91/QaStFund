# QastFund product completeness and security report

Assessment date: 2026-10-13 (Asia/Karachi)  
Assessment basis: current repository, checked-in deployment configuration,
submission evidence, and verification results recorded during the final
submission validation.  
Decision boundary: two-user, test-fund-only Arc Testnet validation pilot.

## Executive assessment

QastFund is a credible, working controlled-pilot product rather than a UI-only
prototype. The repository contains an end-to-end employee lending workflow,
role- and organization-scoped application services, a deterministic manual
review process, Circle passkey wallet integration, Arc Testnet settlement and
reconciliation, ERPNext employee synchronization, repayment planning, payroll
proposal controls, delinquency operations, monitoring, tests, recovery tooling,
and a repeatable demonstration package.

The product is **ready to demonstrate and suitable for the already accepted
two-user, test-fund-only validation scope**. It is **not sufficiently assured
for public lending, production funds, or broader employee deployment**.
Production readiness is blocked primarily by signer custody, target-host and
recovery evidence, undeployed edge hardening, external Circle configuration,
independent security review, and legal/privacy controls.

### Completeness estimate

These percentages are an engineering assessment, not a certification or a
mathematical test-coverage measurement.

| Target                         | Estimated completeness | Assessment                                                                                                                 |
| ------------------------------ | ---------------------: | -------------------------------------------------------------------------------------------------------------------------- |
| Submission/demo package        |                 90–95% | Core assets and repeatable local demo exist; genuine screenshots/video remain manual.                                      |
| Existing controlled pilot      |                 85–90% | Core lifecycle and evidence exist; a new live action is gated by stale reconciliation health.                              |
| Broader external testnet pilot |                 55–65% | Needs deployed hardening, host evidence, operational ownership, recovery rehearsal, and external assurance.                |
| Production financial service   |                 35–45% | Functional foundation exists, but security operations, compliance, custody, resilience, and scale controls are incomplete. |

The apparent UI and workflow completeness is higher than the production
completeness. This is expected for a controlled-pilot system: the remaining
work is dominated by assurance and operational controls that cannot be proven
by source code alone.

## Feature inventory

### Implemented and verified

| Capability                      | Current evidence                                                                                                                                                                                                                           | Maturity                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Public site and authentication  | Sign-in, sign-out, registration, invitations, password reset, profile, server-side sessions, protected routes, and role routing exist. Employee access to employer pages is rejected or redirected.                                        | Pilot-ready                                                                      |
| Organization and role isolation | Employer-admin and employee policies are resolved from database sessions; tenant-owned operations use organization identifiers. Authorization regression coverage exists.                                                                  | Pilot-ready; independent tenancy testing still recommended                       |
| Employee onboarding             | Employer onboarding, employee directory mapping, invitations, eligibility status, and lending-access controls exist.                                                                                                                       | Pilot-ready                                                                      |
| ERPNext employee sync           | Read-only bounded ingestion, scheduled and manual sync paths, mapping, review queue, freshness rules, and health reporting exist. A fresh audit matched 3/3 enabled records with no review diagnostics.                                    | Pilot-ready for the approved source                                              |
| Loan marketplace                | Employees can create/fund offers, browse available offers, inspect quotes, and view lender exposure and repayment information.                                                                                                             | Pilot-ready                                                                      |
| Loan application                | Applications are recorded before a wallet action, idempotent requests are supported, and hard eligibility failures fail closed.                                                                                                            | Pilot-ready                                                                      |
| Deterministic decision process  | Versioned rules produce explicit reason codes and `REVIEW_REQUIRED`; no unsupported ML score or automatic approval is claimed.                                                                                                             | Pilot-ready                                                                      |
| Employer manual review          | Authorized employer administrators can approve or reject with a recorded rationale, reviewer identity, timestamp, and audit event. Review alone cannot move funds.                                                                         | Pilot-ready                                                                      |
| Circle wallets and passkeys     | Enrollment, ownership challenge, wallet binding, passkey-controlled operations, and configuration tests exist. Two distinct pilot wallets were ownership verified during preflight.                                                        | Pilot-ready within the verified Circle configuration boundary                    |
| Arc escrow lifecycle            | Offer funding, authorized acceptance, receipt-confirmed activation, repayment, event verification, and testnet reconciliation exist. The recorded Arc audit found 3 offers, 3 loans, 8 receipts, and no journal problems or stale intents. | Existing V1 lifecycle demonstrated                                               |
| Partial loan acceptance         | The V2 contract and application tests cover bounded partial acceptance, multiple borrowers, over-acceptance rejection, and duplicate protection.                                                                                           | Implemented and locally tested; no V2 deployment claimed                         |
| Repayment plans                 | One-, two-, and three-installment plans, consent, due dates, allocation ordering, partial allocations, balances, and history exist in application data and tests.                                                                          | Locally demonstrated; distinct from the deployed V1 full-repayment contract path |
| Payroll deduction workflow      | Employee authorization, employer approval, idempotent proposals, reconciliation boundaries, and failure states exist.                                                                                                                      | Internal workflow implemented; ERPNext payroll writeback intentionally blocked   |
| Delinquency management          | Overdue calculations, cases, notifications, review actions, arrangement requests, partial-payment behavior, retry handling, and audit records exist.                                                                                       | Locally demonstrated                                                             |
| Financial integrity             | Database constraints, advisory locks, idempotency keys, transaction intents, receipt/event verification, duplicate-event handling, ledger checks, and reconciliation tests exist.                                                          | Strong controlled-pilot foundation                                               |
| Operational health              | Liveness, readiness, dependency health, scheduler heartbeats, incident states, and sanitized reporting exist.                                                                                                                              | Implemented; hardened public behavior not yet deployed                           |
| Backup and disaster recovery    | Custom-format PostgreSQL backups, SHA-256 verification, guarded restore, and isolated restore/reconciliation verification exist. The latest disposable recovery run passed 4/4 tests.                                                      | Locally verified; target-host rehearsal missing                                  |
| Demonstration package           | Guarded startup, deterministic fixtures, demo script, runbook, presentation content, feature evidence, and screenshot checklist exist.                                                                                                     | Submission-ready apart from manual media capture                                 |

### Implemented but incomplete or externally blocked

| Capability                    | What is missing                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live reconciliation readiness | The latest preflight returned `NOT READY FOR PILOT` because the persisted reconciliation cursor was stale. An authorized bounded catch-up and a fresh passing audit/preflight are required before another live Arc action. |
| Production edge hardening     | Bearer-protected dependency health, public denial of `/api/internal/*`, HSTS, frame denial, and a baseline CSP are checked in and locally validated, but public probes still observed the previous deployment.             |
| Session-cookie assurance      | Code sets `HttpOnly`, `SameSite=Lax`, and `Secure` in production, but the deployed cookie flags have not been captured through an authenticated production response.                                                       |
| Circle production assurance   | Repository tests cannot verify Circle Console relying-party/origin, callback allowlist, client-key restrictions, or recovery policy. Sanitized console evidence is required.                                               |
| Signer custody                | The signer is server-only and matches the immutable escrow signer, but managed KMS/HSM custody, least privilege, access logging, backup, compromise detection, and rotation rehearsal are not evidenced.                   |
| Recovery and rollback         | Local disposable restore passed, but target backup inventory, off-host retention/PITR, production-like restore, pinned-image rollback, Arc replay, and measured RPO/RTO are absent.                                        |
| Email delivery                | SMTP authentication was verified without sending a message; actual delivery, bounce handling, escalation, and recipient behavior were not exercised.                                                                       |
| Operational ownership         | Named support owners, escalation contacts, service hours, participant/exposure caps, pause criteria, complaint handling, and loss responsibility are incomplete.                                                           |
| Independent assurance         | No independent Solidity audit, penetration test, dependency review, privacy assessment, or legal/lending approval is evidenced.                                                                                            |

### Intentionally unavailable or not implemented

- Public or real-money lending.
- ERPNext payroll writeback; the adapter deliberately fails closed with
  `ERP_NEXT_PAYROLL_WRITE_NOT_CONFIGURED`.
- Automatic credit approval or a trained credit model.
- A production-deployed V2 escrow for partial offer acceptance.
- Partial repayment on the deployed Arc V1 escrow; its demonstrated live path
  uses exact full acceptance and full repayment.
- Application-driven funded-offer cancellation and reconciliation of
  `OfferCancelled`.
- An on-chain transition corresponding to application status `DEFAULTED`.
- Contract pause/rescue controls or in-place signer rotation.
- Independently enforced database row-level security and immutable audit-log
  database roles/triggers.
- A verified screenshot set or recorded demo video.

## Security assessment

### What is already strong

- Authorization is enforced on the server using database-resolved sessions,
  roles, active membership, employment state, and organization scope.
- Financial and administrative routes use input validation, exact-origin
  checks, rate limits, and idempotency protections.
- Session cookies are configured in code as `HttpOnly`, `SameSite=Lax`, and
  production-only `Secure`.
- Invitations and password-reset tokens are random, hashed at rest, expiring,
  and single-use. Passwords use scrypt.
- Employer approval cannot itself move funds; the employee wallet/passkey
  boundary remains separate.
- Chain ID, contract, token, signer, authorization expiry, transaction receipt,
  emitted events, and contract state are verified before application state is
  finalized.
- Database constraints, transactions, locks, intent state machines, and unique
  idempotency keys reduce duplicate disbursement, repayment, and allocation
  risk.
- Reconciliation is finality-aware, replay-safe, and preserves unmatched or
  conflicting events for investigation rather than silently rewriting them.
- Logs redact common credential fields. Environment files are ignored, and
  sensitive signing material is server-side.
- The checked-in deployment publishes only Caddy ports 80/443 and places the
  application, scheduler, and PostgreSQL on restricted Docker networks.
- The latest application, contract, local-chain, live-configuration, Arc,
  ERPNext, build, schema, and recovery checks produced substantial regression
  evidence.

### Important remaining security risks

#### High severity

1. **Signer custody and recovery are not production-grade.** The immutable
   signer makes loss or compromise operationally expensive. Managed custody,
   access controls, audit logs, recovery, and replacement/wind-down procedures
   must be proven before production funds are permitted.
2. **Target recovery and rollback are unproven.** A local restore test does not
   demonstrate that the deployed service can meet an acceptable RPO/RTO or
   safely reconcile Arc after recovery.
3. **Independent assurance is absent.** Financial smart-contract and web
   application code should receive an independent audit and penetration test.
   Legal, lending, employment, privacy, consent, and retention requirements
   also need qualified review.

#### Medium severity

1. The checked-in edge protections are not yet deployed and externally
   recaptured. The currently public dependency-health endpoint still reflects
   the older behavior.
2. Target-host sockets, Docker bindings, firewall/security-group rules, and
   bypass paths have not been inspected directly by an authorized operator.
3. Deployed session-cookie flags and Circle Console origin/callback/recovery
   settings remain unverified.
4. The escrow cannot be paused or rescued, and signer replacement requires a
   new deployment. This is a deliberate custody tradeoff, but it requires a
   documented incident and migration plan.
5. Application/on-chain lifecycle coverage is incomplete for lender
   cancellation and default status.
6. Audit logs are append-only by application convention, not by a restricted
   database role or database trigger.
7. The Arc audit command is capped at 500 records per category without
   pagination or fail-on-overflow behavior.
8. The recorded dependency audit has nine high-severity transitive toolchain
   findings. They should be resolved through compatible upstream upgrades and
   regression testing, not a forced breaking downgrade.

#### Defense in depth

- Enforce a dedicated managed `RATE_LIMIT_HASH_SECRET` in every deployed
  environment rather than permitting the development fallback.
- Extend the baseline CSP to scripts, styles, connections, and other relevant
  directives after verifying Next.js and Circle wallet compatibility.
- Add stronger administrative authentication, preferably phishing-resistant
  MFA or enterprise SSO, before onboarding external organizations.
- Consider PostgreSQL row-level security and database-enforced immutability as
  additional protections, while retaining application authorization.
- Add automated secret scanning, dependency scanning, SAST, contract fuzzing,
  and release provenance/SBOM checks to CI.

### Security verdict

The application has a thoughtful security foundation and meaningful automated
evidence. It is **reasonably secured for its narrow, operator-controlled,
test-fund-only pilot**, provided no new live action occurs while preflight is
not ready. It should **not be described as production-secure**. The missing
controls are material because they concern key compromise, recovery, deployed
configuration, independent validation, and regulated financial operations.

## Quality and verification evidence

The final submission validation recorded:

- 447 application tests passed and 1 skipped across 74 files;
- 29/29 smart-contract tests passed;
- 2/2 local-chain lifecycle tests passed;
- 2/2 live Circle/Arc configuration tests passed;
- Arc audit passed with 3 offers, 3 loans, 8 receipts, zero journal problems,
  and zero stale intents;
- ERPNext audit passed with 3/3 mappings and a successful scheduled sync;
- disaster recovery passed an isolated backup, checksum, restore, cursor, and
  4/4 recovery/reconciliation test sequence;
- typecheck, lint, formatting, Prisma validation/status, production build,
  Caddy validation, Compose parsing, and `git diff --check` passed;
- public HTTPS and health returned `200`, while HTTP redirected to HTTPS with
  `308`; and
- the latest pilot preflight failed only the reconciliation-freshness gate and
  therefore correctly returned `NOT READY FOR PILOT`.

These results are strong evidence for a demonstration and controlled pilot.
They are not a substitute for independent testing or production operational
evidence.

## Recommended completion plan

### P0 — before any additional live Arc action

1. Have an authorized operator review and run the bounded Arc reconciliation
   catch-up.
2. Rerun the read-only Arc audit and pilot preflight.
3. Proceed only if the audit has no unmatched/conflicting records or stale
   intents and preflight explicitly reports ready.

### P0 — before an external or production pilot

1. Move signer material to a managed KMS/HSM or equivalent controlled secret
   service; define access, logging, backup, compromise detection, rotation, and
   immutable-signer replacement/wind-down procedures.
2. Deploy the checked-in dependency-health and Caddy hardening through an
   authorized change. Verify external `401`/`404` behavior, HSTS/CSP/frame
   headers, authenticated health access, and monitoring-client compatibility.
3. Capture target-host evidence for listening sockets, container port
   publishing, Docker networks, firewall/security groups, scheduler operation,
   and sanitized logs.
4. Capture the actual production session cookie and verify `Secure`,
   `HttpOnly`, `SameSite`, path, and expiry without retaining its value.
5. Review Circle Console settings for the exact production origin,
   relying-party ID, callbacks, client-key restrictions, and wallet recovery.
6. Run a timed recovery exercise in isolated production-like infrastructure:
   restore a real sanitized backup, deploy a pinned previous image, replay Arc,
   reconcile differences, and record achieved RPO/RTO.
7. Obtain an independent smart-contract audit, application penetration test,
   dependency review, and remediation sign-off.
8. Obtain jurisdiction-specific legal, lending, employment, privacy, consent,
   retention, servicing, and complaints approval.

### P1 — before scaling the pilot

1. Approve explicit limits for participants, organizations, per-loan exposure,
   aggregate exposure, duration, supported assets, support hours, escalation,
   pause criteria, and loss responsibility.
2. Add audit pagination or fail closed when the current 500-record bound is
   exceeded.
3. Add application and reconciliation support for funded-offer cancellation,
   or explicitly prohibit and operationalize it.
4. Define how application defaults correspond to on-chain state and reporting.
5. Add database-enforced audit immutability and evaluate row-level security.
6. Complete compatible dependency upgrades and introduce continuous security
   scanning and contract fuzz/property testing.
7. Exercise real email delivery, bounce/failure recovery, and alert escalation
   in a non-production test domain.

### P2 — submission and product polish

1. Capture the genuine screenshot set using the existing checklist and record
   a short demo video with all secrets and personal data excluded.
2. Conduct a presenter dry run of employee, employer, payroll, delinquency, and
   read-only evidence paths.
3. Improve accessibility, responsive-layout, and usability evidence with
   representative users; these areas are not covered by the technical test
   counts.

## Final decision

| Scope                                        | Decision                                          | Reason                                                                                                 |
| -------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Local submission demonstration               | **GO**                                            | Repeatable startup, deterministic fixtures, documentation, and automated evidence are available.       |
| Frozen evidence walkthrough                  | **GO**                                            | Arc and ERPNext evidence is recorded and can be shown without moving funds.                            |
| New live Arc Testnet action                  | **NO-GO until reconciliation and preflight pass** | Current reconciliation freshness gate is closed.                                                       |
| Existing two-user/test-fund controlled pilot | **Conditional GO within the recorded boundary**   | Previously accepted scope remains valid; no expansion or new action bypassing preflight is authorized. |
| External/public testnet lending              | **NO-GO**                                         | Host, deployed security, custody, recovery, operational, legal, and privacy gates remain open.         |
| Production/real-money lending                | **NO-GO**                                         | Material security, resilience, compliance, and independent-assurance requirements are incomplete.      |

## Evidence references

- [Controlled-pilot readiness](./CONTROLLED_PILOT_READINESS.md)
- [Technical architecture](./ARCHITECTURE.md)
- [Lending security audit](./P2P_LENDING_SECURITY_AUDIT.md)
- [Financial invariants and threat model](./FINANCIAL_INVARIANTS_AND_THREAT_MODEL.md)
- [Database backup and disaster recovery](./DATABASE_BACKUP_AND_DISASTER_RECOVERY.md)
- [Operations and incident recovery](./OPERATIONS_AND_INCIDENT_RECOVERY.md)
- [Demonstration runbook](./DEMONSTRATION_RUNBOOK.md)
- [Submission feature status](../submission/FEATURE_STATUS.md)
- [Submission demo script](../submission/DEMO_SCRIPT.md)
