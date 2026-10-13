# QastFund submission summary

Prepared: 2026-10-13 (Asia/Karachi)  
Milestone deadline: 2026-10-15  
Submission date: 2026-10-17

## Problem

Employees may need transparent short-term financing but lack a trustworthy way
to connect verified employment status with peer funding. Employers can verify
workforce eligibility, yet should not silently score employees, control their
wallets, or treat an HR record as permission to move funds.

## Solution

QastFund combines an employer-synchronized employee directory, conservative
human-reviewed loan applications, user-controlled Circle passkey wallets, and
an Arc Testnet escrow. The employer verifies eligibility and records an
auditable decision; the employee remains the only party who can authorize the
wallet transaction.

Key differentiators are:

- ERPNext-backed employment freshness and identity mapping that fail closed;
- no machine-learning score or automatic approval unsupported by current data;
- immutable, rationale-backed employer review separated from fund movement;
- passkey-controlled transactions with exact receipt/event verification;
- idempotent intents and finalized-event reconciliation for safe recovery;
- an explicit evidence-based boundary between testnet validation and production
  readiness.

## Implemented scope

- Public, employee, and employer experiences in a Next.js modular monolith.
- Organization-scoped authentication, roles, origin checks, input validation,
  rate limiting, audit events, and operational health reporting.
- Read-only ERPNext employee synchronization, invitations, lifecycle handling,
  review records, freshness enforcement, and scheduled execution.
- Deterministic `loan-decision-manual-review-v1` decisions with no calculated
  score and mandatory authorized review for otherwise eligible applications.
- Circle Modular Wallet enrollment, ownership binding, and passkey-controlled
  Arc Testnet user operations.
- Solidity escrow offer funding, short-lived EIP-712 borrow authorization,
  disbursement, full repayment, exact receipt validation, and reconciliation.
- PostgreSQL financial constraints, transaction idempotency, backup/restore
  tooling, local-chain lifecycle validation, and operational recovery guidance.

## Verified technical results

The controlled-pilot evidence freeze records:

| Verification                  | Result                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Application regression        | 415 passed, 1 skipped across 69 files                                              |
| Contract tests                | 23/23 passed                                                                       |
| Local-chain lifecycle         | 2/2 passed                                                                         |
| Live Circle/Arc configuration | 2/2 passed                                                                         |
| Arc audit                     | 3 offers, 3 loans, 8 receipts; zero journal problems and zero stale intents        |
| ERPNext audit                 | 3/3 mappings matched; fresh scheduled sync; zero review records                    |
| Pilot preflight               | `READY FOR CONTROLLED ARC TESTNET PILOT`                                           |
| Static quality                | Typecheck, lint, formatting, Prisma validation/status, and production build passed |
| Public edge                   | HTTPS, HTTP-to-HTTPS redirect, and HTTPS health endpoint verified on 2026-10-12    |

These are recorded results, not a claim that every command was rerun while this
summary was written. The command list, timestamps, qualifications, and focused
security/recovery checks are maintained in
[`CONTROLLED_PILOT_READINESS.md`](./CONTROLLED_PILOT_READINESS.md).

On 2026-10-13, submission-sprint checks reconfirmed valid Compose definitions,
the public HTTPS root/health endpoint and redirect, Arc RPC/escrow/USDC/signer
configuration, and Circle Arc RPC credential acceptance. The workstation's
Docker Desktop and local PostgreSQL were unavailable, so the database-backed
Arc audit, ERPNext audit, and complete preflight did not pass that rerun. This
environment limitation and the required pre-demo retry are recorded in the
[demonstration runbook](./DEMONSTRATION_RUNBOOK.md#submission-sprint-verification-record).

## Acceptance decision

**GO for the existing two-user, test-fund-only Arc Testnet validation pilot.
NO-GO for external/public lending and production financial operations.**

This acceptance is a bounded technical validation. It is not production
security certification, regulatory approval, or authorization for public or
real-money lending.

## Submission evidence

- [Controlled-pilot readiness and evidence index](./CONTROLLED_PILOT_READINESS.md#submission-evidence-index)
- [Technical architecture](./ARCHITECTURE.md)
- [Demonstration runbook](./DEMONSTRATION_RUNBOOK.md)
- [Arc Testnet pilot report](./ARC_TESTNET_PILOT_REPORT.md)
- [End-to-end origination state machine](./LOAN_ORIGINATION_V1.md)
- [Loan-decision data audit](./LOAN_DECISION_DATA_AUDIT.md)
- [ERPNext production validation](./ERPNEXT_PRODUCTION_VALIDATION.md)
- [Financial invariants and threat model](./FINANCIAL_INVARIANTS_AND_THREAT_MODEL.md)
- [Operations and incident recovery](./OPERATIONS_AND_INCIDENT_RECOVERY.md)
- [Database backup and disaster recovery](./DATABASE_BACKUP_AND_DISASTER_RECOVERY.md)

No repository screenshot set, demo recording, presentation deck, or externally
specified hackathon submission form was found during the 2026-10-13 audit.
Those artifacts must not be represented as complete unless separately created
and verified. The demonstration runbook defines a documentation-backed fallback
when live services are unavailable.

## Production-readiness gaps

Before a broader release, QastFund must:

1. Move signing authority to approved managed custody, document access and
   compromise detection, and rehearse replacement of the immutable escrow
   signer with a controlled wind-down/migration.
2. Verify target-host backups, retention/PITR, an isolated restore, application
   rollback to a pinned artifact, Arc replay, and measured RPO/RTO in a dedicated
   recovery window.
3. Independently verify Circle relying-party/origin, callback allowlist,
   client-key restrictions, and recovery policy.
4. Complete independent contract/application security and dependency review.
5. Obtain applicable lending, legal, privacy, consent, retention, complaints,
   servicing, and operational-owner approvals.
6. Close or formally accept the remaining deployment, monitoring, audit-scale,
   and contract lifecycle limitations in the readiness gate matrix.

## Roadmap

The next phase is assurance, not feature expansion: close custody, recovery,
Circle, security, legal, and privacy gates; then repeat the release gate with
sanitized evidence. Machine-learning scoring, new financial products, public
enrollment, real-money settlement, and cosmetic redesign remain outside the
accepted scope until the foundational gates pass.

## Final submission checklist

- [x] Repository-root project overview and reproducible local setup.
- [x] Current implemented architecture and trust boundaries.
- [x] Demonstration procedure with expected results, abort rules, and fallback.
- [x] Frozen test/integration evidence and exact restricted GO/NO-GO decision.
- [x] Known limitations and production-readiness gates.
- [ ] Target-host recovery/rollback and managed signer evidence (broader-release
      blocker; not required for the accepted technical validation).
- [ ] Independent security, legal, and privacy assurance (broader-release
      blocker).
- [ ] Screenshot/video/deck package, if the external submission channel requires
      it; no repository requirement or existing verified artifact was found.
