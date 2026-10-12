# Financial Invariants and Threat Model

Audit date: 2026-10-12. This document describes the repository state at this
milestone. It is not a production-readiness assertion.

## Scope and accounting models

The application has two deliberately different settlement paths:

- `LEGACY` offers use the internal PostgreSQL double-entry ledger. They support
  partial offer consumption and partial repayments.
- `FUNDED` offers use `EmployeeLendingEscrow` and Arc USDC. One escrowed offer
  funds one borrower for the offer's full principal, and the loan is repaid in
  one full on-chain payment. Database rows mirror the chain; they do not settle
  the payment.

Amounts ending in `MinorUnits` are integer cents. Contract amounts ending in
`BaseUnits` are integer USDC base units (six decimals). A displayed/audit cent
for an on-chain amount is rounded up: `ceil(baseUnits / 10,000)`. The exact
contract obligation remains in base units.

## Invariants and equations

### Offer capacity and disbursement

For every offer, `amount > 0` and
`0 <= available <= amount`. Its configured bounds satisfy
`0 < minimum <= maximum <= amount`.

For a legacy acceptance of principal `p`:

```text
minimum <= p <= maximum
p <= available_before
available_after = available_before - p >= 0
```

The conditional database decrement is the capacity reservation. The lender and
borrower ledger accounts are locked in stable order before balance calculation
and posting, so two committed operations cannot spend the same completed
ledger balance. `EXHAUSTED` is set when availability reaches zero.

For a funded on-chain offer, `p` is the complete escrowed principal. The
contract makes the offer inactive before transferring it and maps one
`offerId` to one `loanId`; a second acceptance reverts. The application has a
partial unique index covering unresolved `REQUESTED`/on-chain `APPROVED`
acceptances for an offer and a unique `(contractAddress, chainOfferId)` key.

A loan is disbursed at most once:

- Legacy: one `LOAN_DISBURSEMENT` ledger transaction is allowed for a loan
  reference; the loan, availability decrement, and balanced posting commit in
  one database transaction.
- On-chain: only a successful receipt containing the expected `LoanStarted`
  event, followed by a matching contract read, can move the database loan to
  `ACTIVE`. A database loan row or a submitted hash alone is not settlement.

### Fees, repayments, and principal

The agreed legacy amount is:

```text
fee = ceil(principalMinorUnits * feeRateBasisPoints / 10,000)
agreed = principalMinorUnits + fee
completedRepayments = sum(COMPLETED repayment.amountMinorUnits)
remainingAgreed = agreed - completedRepayments
0 <= completedRepayments <= agreed
```

Legacy repayments apply to the fee first. For a payment `r`:

```text
feeAlreadyPaid = min(completedRepayments_before, fee)
remainingFee = fee - feeAlreadyPaid
principalReduction = min(max(r - remainingFee, 0), outstanding_before)
outstanding_after = outstanding_before - principalReduction
0 <= outstanding_after <= principal
```

Every repayment of a legacy loan locks the loan row before calculating the
sum, and a globally unique request ID makes an identical retry return the
original repayment. The repayment, ledger transfer, principal update, and
audit rows commit atomically.

The contract obligation is:

```text
interestBaseUnits = ceil(principalBaseUnits * interestBps / 10,000)
repaymentBaseUnits = principalBaseUnits + interestBaseUnits
```

The contract accepts exactly that amount once, only from the recorded borrower,
and changes status from `ACTIVE` to `REPAID` before the token transfer (with the
whole transaction reverting if transfer fails). The application permits one
pending repayment intent per loan. A repayment becomes completed only after a
successful receipt contains the exact matching `LoanRepaid` event and a
contract read confirms `REPAID` and the event timestamp.

Permitted exceptions:

- A legacy loan can have several positive partial repayments; an on-chain loan
  has one full repayment.
- On-chain cent views may be one cent higher than the exact base-unit value
  because display/audit conversion rounds up. Settlement always compares exact
  base units.
- `OVERDUE` loans remain repayable. `DEFAULTED` loans are not automatically
  repayable by the current application paths.

### Authorization and decisions

Only an active employee in the actor's organization, with borrowing enabled,
current trusted employee-directory evidence, a ready owned wallet, and current
policy capacity can prepare an on-chain borrow. Self-borrowing, cross-tenant
offers, inactive/expired offers, and inactive/ineligible lenders are rejected.

The rules/model output is not itself approval. The pilot requires one immutable
employer-admin override before the backend signs an EIP-712 authorization.
Tenant-scoped composite foreign keys and actor-derived organization/user IDs
prevent cross-employer review and borrowing writes. Mandatory eligibility
failure reasons cannot be overridden.

The signature binds chain, contract, borrower, offer, authorization ID, and a
five-minute expiry. The contract consumes the authorization ID once.

### Ledger and settlement evidence

For every internal posting and asset:

```text
sum(DEBIT entry.amountMinorUnits) = sum(CREDIT entry.amountMinorUnits)
walletBalance = sum(COMPLETED credits) - sum(COMPLETED debits)
```

Entries are positive, account assets and organizations must match, and posting
identity is unique by both idempotency key and financial reference. A
`LedgerTransaction(COMPLETED)` proves only an internal legacy-ledger posting.
It is never proof of an Arc transaction.

For Arc, settlement evidence is a successful canonical receipt/event plus
matching contract state. Funding, acceptance, and repayment submissions are
bound to their first transaction hash before receipt lookup. A timeout leaves
that binding unresolved; a different hash is rejected until the recorded
outcome is resolved.

### Reconciliation

The canonical event identity is
`(chainId, contractAddress, transactionHash, logIndex)`. It is unique. The
worker journals events before applying them, waits for configured finality,
verifies current contract state, sorts by block/log order, and serializes event
application with an advisory lock. `APPLIED` replay returns
`ALREADY_APPLIED`; it does not recreate loans, repayments, or audit rows.

The cursor and lease are persistent. Each run rewinds a configured reorg window
and advances the cursor only with the journaled range. Missing provisional
events become `REORGED`; changed or missing finalized/applied events become
`CONFLICT` and are never reversed automatically. Unmatched finalized events
remain traceable and retry after dependencies arrive. Staleness, backlog,
repeated failures, unmatched events, and persisted alert state are surfaced.

## Threat scenarios and expected outcomes

| Scenario                                      | Expected outcome                                                                          | Executable coverage                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Concurrent legacy borrows / lender spend      | Row/account locks and conditional capacity decrement allow only available committed funds | `borrow-from-offer`, database borrowing, ledger suites     |
| Concurrent acceptance of one funded offer     | Partial unique index allows one unresolved intent; contract permits one acceptance        | `intent-concurrency`, contract concurrent acceptance tests |
| Duplicate key, same payload                   | Return the original operation/result                                                      | borrowing, repayment, funding, and intent tests            |
| Duplicate key, different payload/tenant       | Return conflict without revealing or changing the original                                | borrowing, intent, authorization tests                     |
| Duplicate repayment notification              | One pending intent and unique request ID; replay is idempotent                            | repayment, intent, reconciliation tests                    |
| Receipt lookup timeout                        | Persist submission hash, leave intent pending, reject a replacement hash                  | `ambiguous-transaction-binding`                            |
| Chain succeeds, callback/database write fails | Finalized event journal recovers the matched pending record                               | reconciliation unit/database/local E2E tests               |
| Reverted receipt                              | Do not activate/repay; mark the known operation failed/cancelled                          | on-chain borrow and contract rollback tests                |
| Duplicate/replayed chain event                | Canonical event uniqueness plus applied-state lock produces no duplicate financial rows   | reconciliation unit/database tests                         |
| Out-of-order event delivery                   | Sort before application; unmatched dependency remains retryable                           | reconciliation unit tests                                  |
| Worker/service restart                        | Persistent cursor, event journal, lease expiry, and alert state resume work               | reconciliation unit/database tests                         |
| Expired offer or stale eligibility            | Reject during authoritative prepare transaction                                           | borrowing/on-chain borrowing tests                         |
| Unauthorized/cross-employer reviewer          | Actor role and organization scope reject before mutation                                  | origination/authorization tests                            |
| Insufficient/concurrently changing liquidity  | Legacy locks and atomic balance check; escrow token transfer is atomic                    | borrowing database and contract transfer-failure tests     |

No lender-withdrawal operation exists in the audited application/contract, so
withdrawal races are not applicable. A wallet owner can move external USDC, but
`createOffer` atomically transfers the exact principal into escrow; a stale
preflight balance can only make that transaction revert.

## Safeguards found

- PostgreSQL transactions, advisory locks, row locks, conditional updates, and
  partial unique indexes around financial transitions.
- Globally unique borrow/funding/repayment request IDs and unique ledger
  idempotency/reference keys.
- Tenant-scoped foreign keys and queries derived from authenticated actors.
- Immutable, versioned origination decisions and one audited admin override.
- OpenZeppelin `SafeERC20`, `ReentrancyGuard`, EIP-712 signatures, consumed
  request/authorization mappings, and checks-effects-interactions ordering.
- Receipt log decoding followed by an authoritative contract-state read.
- Persistent, finality-aware, replay-safe reconciliation with an audit journal.

## Confirmed defects and fixes

1. **High — ambiguous transaction identity could be replaced.** Funding and
   repayment confirmation did not persist the first submitted hash before a
   receipt timeout. A later callback could present another hash while the first
   result was unknown. Funding now conditionally binds
   `fundingTransactionHash`; repayment now binds a unique
   `submissionTransactionHash`. Same-hash retries remain safe, different hashes
   conflict, known failed repayment revival clears the old binding, and
   reconciliation refuses a different repayment event. Regression:
   `tests/ambiguous-transaction-binding.test.ts`.
2. **Medium — core money bounds were application-only.** Direct or future code
   paths could persist negative capacity/outstanding values, invalid offer
   bounds, non-positive repayments/entries, or invalid rates. Database check
   constraints now enforce those bounds. Regression:
   `tests/financial-invariants-database.test.ts`.
3. **Medium — chain offer identity was not unique off-chain.** The contract
   emits one offer ID, but the database could link it to multiple offers. A
   unique `(contractAddress, chainOfferId)` index now rejects that state.

No smart-contract interface was changed.

## Remaining risks

- **High: authorization revocation window.** A borrower who receives a valid
  five-minute authorization can submit it after off-chain eligibility or an
  employer decision changes. The contract can enforce expiry and one-time use,
  but cannot query the database or revoke a signed authorization. A contract
  change would be required (for example, signer-managed revocation/nonces or a
  server-submitted acceptance). That interface change was not made without a
  separate design and migration review. Until then, suspend signing during an
  incident, keep TTL short, and treat eligibility changes inside the TTL as an
  exposure requiring monitoring.
- **Medium: finalized-event conflict is intentionally manual.** A deep reorg or
  provider inconsistency after application is flagged, not reversed. Automatic
  reversal could create a second financial loss. Operators must investigate.
- **Medium: Arc and legacy accounting are separate.** Arc lifecycle audit rows
  are not double-entry ledger postings. Reporting must not aggregate the
  internal ledger as if it represented escrowed USDC.
- **Medium: bounded audits.** `audit:arc` checks a bounded record set. Large
  deployments need pagination/partitioned scheduling and alerting on incomplete
  audit coverage.
- Database constraint deployment will deliberately fail if historical rows
  violate the new invariants. Those rows must be investigated and repaired via
  an approved, audited procedure; the migration must not silently clamp them.

## Operator procedures

For an ambiguous transaction, do not create or submit another financial
operation. Use the stored submission hash, query multiple trusted RPC endpoints
for its canonical receipt, wait the configured confirmation depth, and run the
bounded reconciler. If the receipt is successful but unmatched, keep the event
and intent for investigation. If it is definitively reverted, use the normal
failed-state retry path. Never delete or rewrite the event journal to force a
retry.

For `CONFLICT`, stale cursor, or excessive backlog: pause affected funding and
borrowing, preserve database and RPC evidence, compare the journal event with
the receipt and contract read, restore healthy RPC/cursor operation, and replay
the bounded window. Manual corrections require an immutable incident record
and dual review. Do not mark a database row settled solely from an API callback
or transaction hash.

Before deploying the migration, run read-only queries equivalent to every new
check constraint and investigate all returned rows. Back up PostgreSQL, apply
the migration in staging, run the database and local-chain suites, then verify
reconciliation catches up with zero unresolved conflicts. This milestone did
not deploy or submit any live/testnet financial transaction.

## Validation evidence for this milestone

Mocked/unit tests:

```text
npm test -- --run tests/ambiguous-transaction-binding.test.ts tests/authorization.test.ts tests/borrow-from-offer.test.ts tests/blockchain-reconciliation.test.ts tests/funded-lending-offer.test.ts tests/ledger-wallet.test.ts tests/lending-offers.test.ts tests/loan-lifecycle.test.ts tests/onchain-borrow.test.ts tests/origination-decision.test.ts tests/repay-loan.test.ts --reporter=dot
Result: PASS — 11 files, 122 tests.
```

In-process Hardhat contract tests (simulated chain, no external transaction):

```text
npm run test:contracts
Result: PASS — 23 tests.
```

Static/schema/build checks:

```text
npm run prisma:validate
Result: PASS.
npm run typecheck
Result: PASS (Hardhat compile, Next route generation, TypeScript).
npm run lint
Result: PASS.
npm run build
Result: PASS (Next.js 16.4.0 production build).
```

Database and full local-chain integration evidence is unavailable in this
workspace run. `npm run prisma:status` failed with a Prisma schema-engine error
because PostgreSQL at `localhost:5432` was not reachable. `npm run chain:test`
successfully started an ephemeral Hardhat node and deployed both contracts, but
then failed at the database preparation step for the same reason. Therefore
`tests/financial-invariants-database.test.ts`, the database concurrency suites,
and the complete local-chain application E2E were not claimed as passing.

No testnet/live suite was run, and no live financial transaction was submitted.
