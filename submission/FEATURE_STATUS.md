# QastFund feature status

Status reflects repository inspection and commands executed on 2026-10-13.

## Implemented and tested

| Feature                                       | Evidence                                                                                                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local authentication and role routing         | Demo employee/admin credentials authenticated; protected employee and employer pages returned `200`; employee request to `/employer/payroll` redirected to `/app`.                                                            |
| ERPNext employee directory ingestion          | Read-only adapter, mapping/review UI and tests; frozen live audit recorded 3/3 mappings, fresh scheduled success, and no review records. Local seed uses a clearly invalid placeholder endpoint and is not external evidence. |
| Offer creation and marketplace                | Application regression plus populated `/app/lending` and `/app/borrow` screens.                                                                                                                                               |
| Partial offer acceptance                      | Arc V2 contract tests and application tests cover bounded partial amounts, multiple borrowers, over-acceptance rejection, and duplicate protection. No V2 deployment is claimed.                                              |
| Deterministic loan decision and manual review | Decision/domain/database tests; review-required behavior and organization/admin authorization are implemented. No ML score is claimed.                                                                                        |
| Repayment schedules and allocations           | Local deterministic fixtures include four plans; loan detail renders schedule, history, paid amount, and remaining amount. Tests cover consent, allocation ordering, duplicates, and invariants.                              |
| Payroll proposal workflow                     | One deterministic local `PROPOSED`/`NOT_RECORDED` record; employee consent and employer actions are role protected; payroll tests pass.                                                                                       |
| Delinquency operations                        | One separate local `OPEN`/`PARTIALLY_PAID` case with 24 days overdue and 60.00 USD outstanding; tested review/notification/retry boundaries.                                                                                  |
| Ledger/reconciliation protections             | Intent concurrency, receipt verification, event replay, financial invariant, and reconciliation tests; frozen Arc audit recorded no journal problems.                                                                         |
| Repeatable startup                            | `npm run demo:start` verified Docker PostgreSQL, Prisma schema/migrations, liveness, readiness, and sign-in without resetting data.                                                                                           |
| Safe demo fixtures                            | `npm run demo:data -- --check`; explicit writes require the confirmation phrase, reject production/remote targets, use deterministic IDs, and preserve sessions. Two runs produced stable counts.                             |
| Isolated application tests                    | `npm test` creates a uniquely named local database, applies migrations, runs Vitest, and drops only that database. Tests no longer read or mutate presentation fixtures.                                                      |

Current isolated result: 447 tests passed, 1 skipped across 74 files.

## Implemented but externally blocked or manually controlled

| Feature                           | Boundary                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Circle passkey wallet flow        | Fresh configuration tests passed 2/2 and preflight accepted the Circle Arc RPC credentials and two ownership-verified pilot wallets. A presentation transaction still requires explicit authorization.                                                                                                                                         |
| Arc Testnet transaction lifecycle | A fresh read-only audit passed with 3 offers, 3 loans, 8 verified receipts, zero journal problems, and zero stale intents. No transaction was submitted in final validation. Preflight remains NOT READY because reconciliation health is stale; no new transaction should be shown until authorized catch-up and preflight pass.              |
| Live ERPNext synchronization      | Fresh read-only audit passed: the enabled integration has a successful scheduled run, 3/3 mapped records, and no review diagnostics. Local demo still uses fixtures when the approved source is unavailable.                                                                                                                                   |
| Email delivery                    | SMTP authentication-only verification passed without sending a message. Recipient delivery was not exercised.                                                                                                                                                                                                                                  |
| Production edge hardening         | Checked-in bearer authentication, internal-route denial, HSTS, frame denial, and baseline CSP pass local validation. Final live probes still observed the previous deployment: dependency health returned `200` without authentication, the internal route returned `405`, and the new headers were absent. Deployment requires authorization. |

## Explicit local fixtures—not external transactions

- Demo users, organization, employee mappings, balances, offers, loans,
  installment plans, repayment allocations, one payroll proposal, and one
  delinquency case created by `prisma/seed.ts`.
- Local wallet and transaction-like values are presentation records. They must
  not be described as Circle-owned wallets, Arc receipts, ERPNext deductions,
  or real employee data.

## Incomplete or unavailable

| Feature                        | Current status                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ERPNext payroll writeback      | Intentionally unavailable; fails closed with `ERP_NEXT_PAYROLL_WRITE_NOT_CONFIGURED`. Only proposals and reconciliation boundaries are implemented.                           |
| Public/real-money lending      | Not approved or demonstrated.                                                                                                                                                 |
| Managed signer rotation        | Custody and immutable-signer replacement rehearsal remain outstanding.                                                                                                        |
| Target-host recovery rehearsal | Local isolated restore passed; target restore/rollback/replay and RPO/RTO evidence remain outstanding.                                                                        |
| Complete production CSP        | Baseline frame/base/form policy exists; script/style policy still needs Circle-compatible design and live validation.                                                         |
| Automated screenshot capture   | Browser-control capability was unavailable in this execution environment. No fictional screenshots were created; exact manual captures are listed in `screenshots/README.md`. |
| Demo recording                 | Not created or claimed.                                                                                                                                                       |

## Evidence sources

- `docs/CONTROLLED_PILOT_READINESS.md`
- `docs/ARC_TESTNET_PILOT_REPORT.md`
- `docs/DEMONSTRATION_RUNBOOK.md`
- `docs/OPERATIONS_AND_INCIDENT_RECOVERY.md`
- Commands and expected navigation in `submission/DEMO_SCRIPT.md`
