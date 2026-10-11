# Arc Testnet end-to-end verification report

Date: 2026-10-11 (Asia/Karachi)

Baseline repository revision: `297a7c5` (`preflight complete`), with preserved
uncommitted pilot-preparation changes.

Result: **GO FOR READ-ONLY VERIFICATION OF THE COMPLETED LIFECYCLE; NO-GO FOR
NEW LENDING, UNATTENDED, OR PRODUCTION OPERATION UNTIL ERPNext IS COMPLETE AND
FRESH**

One lending lifecycle has now been matched end to end across successful Arc
receipts, decoded escrow events, USDC transfer logs, current contract state,
application records, audit records, and finalized reconciliation journal rows.
This is evidence for the single lifecycle below, not a general guarantee for
future transactions.

## Verified lifecycle

All times below are Arc block timestamps in UTC. Arc Testnet chain ID is
`5042002`; escrow is
[`0x46c4...66cC`](https://explorer.testnet.arc.io/address/0x46c4a0a877e6967542078A580468b80195c466cC?tab=logs),
and USDC is `0x3600000000000000000000000000000000000000` with six
decimals.

| Operation           | Verified receipt and block                                                                                                                                      | Escrow event                                                                                      | USDC transfer                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Offer funding       | [`0xb205...277c`](https://explorer.testnet.arc.io/tx/0xb2056a23ec61821e3738cb1867c1e4ada779ad3354b4a1976bfa8dea95ce277c), block `66627699`, 2026-10-11 09:38:51 | `OfferCreated(offerId=1, principal=2500000, interestBps=500, duration=2592000)` at log index `22` | lender `0x98d6...1fcD` to escrow, `2500000` base units (2.50 USDC) |
| Borrow/disbursement | [`0xa4ff...291e`](https://explorer.testnet.arc.io/tx/0xa4ff599619548866309d29639531fe43668eacb15b3b194fe7961c66efef291e), block `66628626`, 2026-10-11 09:46:40 | `LoanStarted(loanId=1, offerId=1, principal=2500000, repaymentAmount=2625000)` at log index `28`  | escrow to borrower `0x7Ee8...A957`, `2500000` base units           |
| Full repayment      | [`0x65d3...055e`](https://explorer.testnet.arc.io/tx/0x65d3eb707962fb9b64acd90301c04701f66ff1c4d56f579d00095a4148f0055e), block `66629408`, 2026-10-11 09:53:16 | `LoanRepaid(loanId=1, amount=2625000, repaidAt=1791712396)` at log index `8`                      | borrower directly to lender, `2625000` base units (2.625 USDC)     |

The latest read-only audit observed more than 13,000 confirmations for every receipt.
Each receipt status was `success`. The outer receipt sender and destination are
Circle account-abstraction infrastructure, so financial attribution is based
on the decoded escrow event and token transfer, not the receipt's outer
`from`/`to` fields.

## Contract and database agreement

The contract's current offer `1` retains the lender, 2.50 USDC principal, 5%
fee, 30-day duration, and hashed funding request and is inactive after
acceptance. Contract loan `1` has the same lender and borrower, 2.50 USDC
principal, 2.625 USDC repayment, start `1791712000`, due `1794304000`, status
`REPAID`, and repayment time `1791712396`. Escrow's current USDC balance is
zero.

These values match:

- offer `4bebb11e-0589-4b5c-89bd-c5b8670f0add`, funding request
  `ad0fd0cd-1012-4a5c-b323-5f110e6e484e`, `FUNDED/EXHAUSTED`, chain offer `1`;
- loan `c8cac14f-ea46-44eb-8fcf-60f9313f3a1b`, borrow request
  `84983cf4-fceb-4dfc-8574-de5ff02c2df5`, `REPAID`, chain loan `1`, zero
  outstanding principal;
- repayment `64e2e7cd-0b14-4819-89f1-b0d6764a4d0c`, request
  `ecef8b00-01e7-4639-ab4e-9e04ba0a17d3`, `COMPLETED` at the chain repayment
  time; and
- one activation audit event plus one repayment-completed and one loan-repaid
  audit event, all carrying the applicable public transaction hash.

The exact financial values are retained in `principalBaseUnits=2500000` and
`repaymentBaseUnits=2625000`. Cents-only application fields conservatively
round the 0.125 USDC fee to 13 cents and the 2.625 USDC repayment to 263 cents.
That display/audit rounding is expected and tested; it must not be confused
with the exact amount transferred on chain.

`fundedAt` is the callback completion time (09:38:57.670 UTC), about seven
seconds after the funding block. Loan activation, due, repayment, and closure
timestamps use the contract timestamps exactly.

## Reconciliation result

Before verification, the cursor's last successful run predated the lifecycle,
the journal contained no lifecycle rows, and preflight correctly reported
reconciliation as stale. A bounded manual catch-up then:

- observed exactly one `OFFER_CREATED`, one `LOAN_STARTED`, and one
  `LOAN_REPAID`;
- finalized and marked all three `APPLIED`;
- linked them respectively to the offer, loan, and repayment above; and
- reported `0` unmatched and `0` conflicting events.

An immediate second invocation restarted from the persisted cursor with the
configured reorg rewind, observed no new event, applied nothing twice, and
reported no discrepancy. The cursor initially reached `nextBlock=66638403`,
`finalizedThrough=66638397`, and `consecutiveFailures=0`. During the validation
run Arc advanced fast enough for the cursor to fall 1,353 blocks behind the
finalized head, exceeding the configured 1,000-block health window. Preflight
correctly failed until another two-range catch-up reached block `66639829`.
On the completion recheck it became stale again; a three-range pass reached
block `66642621`, observed no new events, and applied nothing twice. Preflight
then passed. This is direct evidence for the scheduler requirement below. The
strengthened `npm run audit:arc` passed with one offer, one loan, three exact
receipts, no stale intent, and no journal issue.

The audit now requires each stored transaction hash to have a successful
receipt containing the exact expected escrow event and exact USDC transfer. It
also requires a finalized `APPLIED` journal row linked to the expected database
record. A successful receipt without the expected financial semantics no
longer passes this audit.

## Authenticated scheduling evidence

The deployment definition now includes an internal-only
`reconciliation-scheduler` sidecar. It calls the existing reconciliation route
sequentially at `ARC_RECONCILIATION_INTERVAL_SECONDS`, authenticates with the
shared `ARC_RECONCILIATION_CRON_SECRET`, and never places that secret in its
command line or logs. The application retains the PostgreSQL advisory lease as
the authoritative overlap guard, so duplicate scheduler delivery or a second
caller is safe. Each invocation is bounded by the configured range size and
maximum ranges and reports its finalized head, remaining backlog, and whether
it caught up.

The health path now compares the persisted cursor with the finalized Arc head,
in addition to checking elapsed time. Persistent alert state suppresses repeat
notifications, retains failed-delivery state for retry, and emits one recovery
when the worker becomes healthy. Structured logs are the supported baseline
channel; an optional authenticated JSON webhook is available for external
delivery.

Local runtime verification against the configured Arc RPC and database
produced the following evidence without broadcasting a transaction:

- an unauthenticated `POST /api/internal/arc-reconciliation` returned `401`;
- an authenticated invocation returned `200`, advanced a persisted cursor
  across three bounded ranges from a 2,168-block finalized backlog to zero,
  and reported `caughtUp=true`;
- it observed and applied no financial event, so it did not duplicate any
  lifecycle record; and
- it emitted one `STALE` transition and one `HEALTHY` recovery through the
  structured-log channel.

This proves the route, authentication, real RPC/database execution, cursor
progress, backlog reporting, and local alert transitions. It does **not** prove
that the sidecar is running on the target deployment, that its cadence survives
a target-host restart, or that a real external webhook receiver accepts alerts.

## Wider workflow evidence

- Circle: preflight authenticated to the configured Circle Arc RPC. Both users
  have distinct `ACTIVE` Circle modular wallets on chain `5042002`, active
  enrollment state, and consumed exact-match ownership challenges. The live
  receipts passed through Circle account-abstraction infrastructure.
- Authentication and authorization: lender and borrower are distinct active
  employee memberships. Both have `canLend=true` and `canBorrow=true`; stored
  wallet addresses match the event participants. Automated route/application
  tests cover tenant, actor, ownership, and role enforcement. No independent
  browser-session trace was retained for this run.
- ERPNext: the organization has ERPNext enabled and a `CONNECTED` directory
  integration. Both participants are `ACTIVE` with `ERPNEXT` as status source.
  The persisted audit found that the latest 2026-10-05 run retrieved all three
  records but was `PARTIAL`: one active record was unmatched and required
  review, while two invitation deliveries initially failed with
  `EMAIL_AUTHENTICATION_FAILED`. HR subsequently added the trusted source email.
  A read-only requalification check on 2026-10-11 confirmed the correction, and
  the supported manual sync completed at `2026-10-11T13:01:46.471Z` with all
  three records matched, zero reviews, zero errors, and no new invitation.
  Current SMTP authentication succeeds. Both historical invitations were sent
  and accepted, with no unresolved delivery failure remaining. Historical run
  counters are retained rather than rewritten. Scheduling is still disabled in
  the current runtime. New offer funding and borrowing now fail
  closed unless the latest sync is complete, inside
  `ERP_NEXT_ELIGIBILITY_MAX_AGE_MINUTES`, and the employee status came from that
  snapshot. This control was not present during the completed lifecycle.
- Policy and decision flow: policy version `1` allowed lending and borrowing,
  up to 100.00 USDC, 0-5% fee, and 7-60 days. The loan snapshot records that
  policy. Rule-based evaluations recorded `HEALTHY/NONE` after activation and
  `HEALTHY/NONE` with reason `LOAN_REPAID` after repayment.
- Ledger: on-chain lifecycle paths intentionally create no internal
  `LedgerTransaction` or `LedgerEntry`; settlement evidence is the contract,
  receipts, transfer logs, and audit trail.

## Test and validation results

Focused reconciliation/database/scheduler tests pass, including the new case
that journals an already callback-confirmed 2.50/2.625 USDC lifecycle
repeatedly without duplicating repayments or audit events. Coverage includes
unauthorized and duplicate triggers, advisory-lease overlap, bounded catch-up,
persistent cursor restart, transient RPC retry/backoff, process-level scheduler
network failures, persistent alert suppression/retry/recovery, finalized-head
staleness, missed funding/borrow/repayment callbacks, out-of-order dependencies,
unmatched records, contract-state conflicts, provisional and finalized reorg
handling, failed/reverted confirmation paths, exact USDC base units, and
positive fractional-interest rounding.

| Command                           | Result                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| Focused ERPNext/eligibility tests | PASS: 6 files, 68 tests                                       |
| `npm test`                        | PASS: 57 files passed, 1 skipped; 351 tests passed, 1 skipped |
| `npm run test:contracts`          | PASS: 23/23                                                   |
| `npm run test:arc-live`           | PASS: 2/2; read-only Circle/RPC bindings                      |
| `npm run lint`                    | PASS                                                          |
| `npm run typecheck`               | PASS                                                          |
| `npm run build`                   | PASS                                                          |
| `npm run format:check`            | PASS                                                          |
| `npm run prisma:status`           | PASS: all 38 migrations applied                               |
| Scheduler image build             | PASS: `reconciliation-scheduler` target                       |
| Production Compose validation     | PASS                                                          |
| Authenticated local runtime       | PASS: `401` unauthorized; `200` catch-up and recovery         |
| `npm run verify:email-provider`   | PASS: SMTP connection/authentication; no message sent         |
| `npm run verify:erpnext-source`   | PASS: source corrected; zero review records                   |
| `npm run audit:erpnext`           | FAIL: complete/fresh, but scheduled synchronization disabled  |
| `npm run audit:arc`               | PASS: 3 exact receipts, 0 issues                              |
| `npm run pilot:preflight`         | FAIL: Arc cursor stale; required ERPNext scheduling disabled  |

Live tests and preflight are read-only. No additional financial transaction was
submitted by this verification work.

## Known limitations and no-go conditions

1. An authenticated internal Compose scheduler, persistent alert state, and
   optional webhook delivery are implemented and covered by automated tests.
   They have not yet been deployed and observed on the target host. Unattended
   operation remains a no-go until the deployment/restart/stale-alert procedure
   in `ARC_TESTNET_DEPLOYMENT.md` is completed with retained evidence.
2. ERPNext source data and the latest manual sync are now complete and fresh;
   SMTP authentication and both invitation lifecycles are healthy. Scheduling
   is implemented in the existing sidecar but remains disabled and unobserved
   in this runtime. The fresh manual snapshot does not prove unattended
   operation.
3. Reverted and delayed transactions were not deliberately induced on Arc
   Testnet. Those paths are covered by mocks/local-chain tests only.
4. The reconciler handles `OfferCreated`, `LoanStarted`, and `LoanRepaid` but
   does not journal the contract's `OfferCancelled` event. Cancellation
   callback recovery remains a gap outside this completed lifecycle.
5. The read-only audit is capped at 500 records per category. Pagination or an
   explicit failure on overflow is required before materially larger pilots.
6. Circle recovery-signer and account-recovery operations were not exercised.
7. One successful lifecycle is insufficient evidence for production
   reliability, load, alerting, or disaster recovery.

## Prioritized next steps

1. Deploy and observe the authenticated reconciliation scheduler through at
   least one restart and stale-alert recovery window; retain scheduler logs,
   dependency health, cursor progress, and alert/recovery delivery evidence.
2. Through the approved target-host secret workflow, configure and enable the
   internal ERPNext scheduler. Retain a subsequent `SCHEDULED/SUCCESS` run,
   restart evidence, fresh dependency health, and alert/recovery evidence.
3. Add `OfferCancelled` ingestion/application and test missed-callback,
   duplicate, and reorg behavior.
4. Make audit record limits explicit failures or paginate them, then retain
   its JSON evidence as a pilot artifact.
5. Run additional minimum-value and fractional-fee controlled lifecycles only
   under separate transaction approval; do not induce reverts on shared
   testnet funds merely to duplicate local negative tests.
