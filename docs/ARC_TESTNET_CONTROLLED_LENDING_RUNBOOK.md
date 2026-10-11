# First controlled Arc Testnet lending runbook

Last reviewed: 2026-10-11

Status: **PREPARED — LIVE LENDING TRANSACTION NOT EXECUTED**

This runbook is the approval boundary for the first end-to-end lending
transaction. Preparation, preflight, audits, and automated tests are safe to
run without moving funds. Stop before every passkey prompt unless the operator
has separately approved the live run.

## Fixed pilot configuration

| Item                    | Required value                                                             |
| ----------------------- | -------------------------------------------------------------------------- |
| Chain                   | Arc Testnet (`5042002`)                                                    |
| RPC                     | `https://rpc.testnet.arc.io`                                               |
| ERC-20 USDC             | `0x3600000000000000000000000000000000000000` (6 decimals)                  |
| Escrow                  | `0x46c4a0a877e6967542078A580468b80195c466cC`                               |
| Escrow deployment block | `66108453`                                                                 |
| Borrow authorizer       | `0xa9200E14C8BeA07187368232455b2b1c8F2Bc63f`                               |
| Organization            | Qasim Funds                                                                |
| Candidate wallet A      | `231572@students.au.edu.pk` — `0x7Ee89f2bE8C1e15C92b4577B3BE3A0bddB5CA957` |
| Candidate wallet B      | `zhzaidi91@gmail.com` — `0x98d66F9B53f7A71DCC5CDb96E4176fF80a6b1fcD`       |

Both candidates are active employees with `canLend` and `canBorrow` enabled.
The operator must record which candidate is the lender and which is the
borrower before beginning. Never use the same identity on both sides.

## Smallest supported transaction

Use these terms for the first run:

| Term      | Display value |     Contract value |
| --------- | ------------: | -----------------: |
| Principal |   `0.01 USDC` | `10000` base units |
| Interest  |          `0%` |   `0` basis points |
| Duration  |      `7 days` |   `604800` seconds |
| Repayment |   `0.01 USDC` | `10000` base units |

The Solidity contract accepts any positive principal, but the application
persists monetary amounts in cents and therefore requires at least `0.01`
USDC. Seven days is the current organization policy minimum. Zero interest is
allowed and avoids fractional-base-unit or cent-rounding effects in the first
run.

## Existing transaction sequence

### 1. Lender funds an offer

UI: sign in as the designated lender, open `/app/lending#new-offer`, enter the
fixed terms, and select **Fund lending offer**.

1. `POST /api/lending-offers/funding-intents` receives a fresh UUID
   `requestId`, `amount`, `interestRate`, and `durationDays`.
2. The server verifies the employee membership, `canLend`, USD organization,
   active owned Arc wallet, organization policy, ERC-20 balance, contract, and
   idempotency key. It creates a database offer with `status=PAUSED` and
   `fundingStatus=PENDING`.
3. The lender's Circle smart account displays a passkey confirmation for one
   batched user operation containing:
   - `USDC.approve(escrow, 10000)`; and
   - `EmployeeLendingEscrow.createOffer(10000, 0, 604800, requestIdBytes32)`.
4. The contract transfers exactly `10000` base units into escrow, marks the
   request ID used, increments `nextOfferId`, increases `totalReserved`, and
   emits `OfferCreated`.
5. Circle waits for the user-operation receipt and returns the underlying Arc
   transaction hash.
6. `POST /api/lending-offers/funding-intents/{offerId}/confirm` verifies the
   successful receipt and exact event. The offer becomes `FUNDED` and `ACTIVE`,
   and stores `chainOfferId`, `fundingTransactionHash`, and `fundedAt`.

### 2. Borrower accepts the offer

UI: sign out completely, sign in as the distinct borrower, open `/app/borrow`,
select the controlled offer, review it at `/app/borrow/{offerId}`, and select
**Confirm borrowing**.

1. `POST /api/lending-offers/{offerId}/acceptance-intents` receives a fresh
   UUID `requestId`.
2. The server rechecks the borrower membership, `canBorrow`, debt capacity,
   active owned wallet, same-organization lender, live active contract offer,
   and immutable contract authorizer. It creates a `REQUESTED` loan.
3. The server signs a five-minute EIP-712 `BorrowAuthorization` with the
   server-only authorizer. The signature binds the chain offer ID, borrower
   wallet, expiry, one-time authorization ID, chain ID, and escrow address.
4. The borrower confirms a Circle user operation calling
   `EmployeeLendingEscrow.acceptOffer` with the chain offer ID, expiry,
   authorization ID, and server signature. No token approval is needed for
   acceptance.
5. The contract consumes the offer and authorization, reduces
   `totalReserved`, creates an active loan, transfers the principal from escrow
   to the borrower, and emits `LoanStarted`.
6. `POST /api/loans/{loanId}/acceptance/confirm` verifies the receipt, event,
   and current contract loan. The database loan becomes `ACTIVE`, stores
   `chainLoanId` and `acceptanceTransactionHash`, the offer becomes
   `EXHAUSTED`, and one `LOAN_ACTIVATED` audit event is created.

### 3. Borrower repays in full

UI: while still signed in as the borrower, open `/app/loans/{loanId}` and
select **Repay $0.01**, then **Confirm Repayment**.

1. `POST /api/loans/{loanId}/repayment-intents` receives a fresh UUID
   `requestId` and verifies the borrower, wallet, database/contract loan state,
   exact full repayment, balance, and idempotency state. It creates one
   `PENDING` repayment row.
2. The borrower confirms one batched Circle user operation containing:
   - `USDC.approve(escrow, 10000)`; and
   - `EmployeeLendingEscrow.repayLoan(chainLoanId)`.
3. The contract transfers the exact repayment directly from borrower to
   lender, marks the loan repaid, and emits `LoanRepaid`. Escrow should remain
   empty.
4. `POST /api/loans/{loanId}/repayment-intents/{repaymentId}/confirm` verifies
   the receipt, event, and current contract state. The loan becomes `REPAID`,
   the repayment becomes `COMPLETED`, and `REPAYMENT_COMPLETED` plus
   `LOAN_REPAID` audit events are created.

On-chain lifecycle paths do not create internal `LedgerTransaction` or
`LedgerEntry` rows. The contract and verified transaction hashes are the
settlement evidence; `AuditEvent` records provide the application audit trail.

## Expected state checkpoints

| Checkpoint            | Wallet and escrow                                                 | Contract                                                           | Database                                                                                     |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Before funding        | Each selected wallet has 5 USDC; escrow has 0                     | `totalReserved=0`; no pilot offer                                  | No `PENDING`/`FUNDED` on-chain offer for this run                                            |
| Funding intent only   | No balance change                                                 | No change                                                          | Offer `PAUSED/PENDING`; UUID funding request stored                                          |
| Offer confirmed       | Lender down 0.01 plus any fee; escrow up 0.01                     | Offer active; request consumed; `totalReserved=0.01`               | Offer `ACTIVE/FUNDED`; chain offer ID and funding hash stored                                |
| Borrow intent only    | No balance change                                                 | No change; authorization unused                                    | Loan `REQUESTED`; five-minute authorization returned                                         |
| Borrow confirmed      | Escrow down 0.01; borrower up 0.01 less any fee                   | Offer inactive; authorization used; loan active; `totalReserved=0` | Loan `ACTIVE`; offer `EXHAUSTED`; acceptance hash and `LOAN_ACTIVATED` stored                |
| Repayment intent only | No balance change                                                 | No change                                                          | Repayment `PENDING`                                                                          |
| Repayment confirmed   | Borrower down 0.01 plus any fee; lender up 0.01; escrow remains 0 | Loan `REPAID`; `repaidAt>0`                                        | Loan `REPAID`; repayment `COMPLETED`; repayment hash and two audit events stored             |
| Reconciled            | No balance change                                                 | No change                                                          | Three finalized journal events become `APPLIED`; no unmatched/conflict event; cursor healthy |

Gas is paid in Arc's native USDC representation and can make wallet balance
deltas slightly larger than the ERC-20 business amount. Verify contract events
and token transfers rather than inferring success from wallet deltas alone.

## Abort conditions

Stop before the next passkey confirmation if any of these is true:

- `npm run pilot:preflight` is not fully passing;
- the UI, wallet, RPC, or receipt reports a chain other than `5042002`;
- token or escrow addresses differ from the fixed values above;
- the configured/server-derived/contract authorizer addresses do not match;
- the lender and borrower are not distinct active users and wallet addresses;
- either wallet cannot reconnect with its existing passkey;
- the lender has less than the principal plus a fee reserve;
- the borrower has less than the full repayment plus a fee reserve before
  repayment;
- the selected offer is not the newly recorded `FUNDED/ACTIVE` offer with the
  exact principal, rate, duration, lender, contract, and request ID;
- an idempotency request returns a conflict, another pending intent exists, or
  the offer/loan has already changed state;
- the five-minute borrow authorization is expired or binds a different
  borrower, offer, chain, or contract;
- a transaction reverts, remains unknown, lacks the expected escrow event, or
  its receipt/event/contract state disagree;
- reconciliation reports any `UNMATCHED` or `CONFLICT` event.

Do not retry a passkey transaction merely because the confirmation callback
was interrupted. Borrow and repayment screens persist the request, operation,
and transaction hash in browser storage and provide a safe resume path. For a
funding callback interruption, record the transaction hash and run
reconciliation before considering another offer.

## Automated negative coverage

The repeatable local suites cover the conditions that should not be induced on
Arc Testnet:

- contract funding rejects zero principal, zero duration, interest above 100%,
  duplicate request IDs, insufficient balance/allowance, unsupported transfer
  behavior, and unauthorized cancellation;
- acceptance rejects a wrong signer, wrong borrower, wrong offer, expired or
  replayed authorization, wrong chain/domain contract, self-borrowing, a
  cancelled/missing/already-consumed offer, and failed principal transfer;
- repayment rejects a wrong borrower, duplicate or missing loan, insufficient
  balance/allowance, and failed transfer while leaving the loan active;
- application tests cover policy/organization/eligibility isolation, exact
  receipt-event matching, request-key conflicts, concurrent intent creation,
  failed transaction state, safe confirmation retry, and timestamp/interest
  rounding;
- reconciliation tests recover missed funding, acceptance, and repayment
  callbacks idempotently without cross-tenant writes or duplicate audit rows;
- the local end-to-end test verifies wallet enrollment, escrow funding,
  authorization, borrowing, repayment, balances, and final database/contract
  agreement. The contract suite separately proves the minimum `0.01 USDC`, 0%,
  seven-day lifecycle.

## Separately approved manual checklist

### Non-transactional preparation

- [ ] Record explicit approval for one `0.01 USDC`, 0%, 7-day Arc Testnet loan.
- [ ] Record the designated lender email/address and borrower email/address.
- [ ] Confirm both operators understand that every passkey prompt is a live
      transaction boundary.
- [ ] Run `npm run pilot:preflight` and retain the fully passing output.
- [ ] Run `npm run audit:arc` and retain `ok: true` with no issues.
- [ ] Confirm no pilot `PENDING`/`FUNDED` offer, on-chain loan, or pending
      repayment already exists.
- [ ] Capture starting ERC-20/native balances, escrow balance,
      `nextOfferId`, `nextLoanId`, and `totalReserved` read-only.

### Live actions — require separate approval

- [ ] Lender creates exactly `0.01 USDC`, 0%, 7 days and confirms the single
      approval/funding passkey prompt.
- [ ] Record funding UUID, database offer ID, chain offer ID, transaction hash,
      block, receipt status, and `OfferCreated` fields.
- [ ] Verify offer and escrow checkpoints before continuing.
- [ ] Borrower confirms the exact controlled offer before authorization expiry.
- [ ] Record borrow UUID, database loan ID, chain loan ID, authorization ID and
      expiry (never the private signing key), transaction hash, block, receipt,
      and `LoanStarted` fields.
- [ ] Verify borrower, loan, and zero-reserved-escrow checkpoints.
- [ ] Borrower repays exactly the displayed full amount and confirms the single
      approval/repayment passkey prompt.
- [ ] Record repayment UUID, repayment ID, transaction hash, block, receipt,
      and `LoanRepaid` fields.

### Post-transaction evidence

- [ ] Wait at least the configured five confirmation blocks.
- [ ] Run `npm run reconcile:arc`, then `npm run audit:arc`.
- [ ] Verify three `APPLIED` journal events and zero unmatched/conflict events.
- [ ] Verify final wallet, escrow, contract, offer, loan, repayment, and audit
      states against the checkpoint table.
- [ ] Update `docs/ARC_TESTNET_PILOT_REPORT.md` with public transaction evidence
      only. Never record passkeys, private keys, API secrets, or recovery data.

No item in the live-action section is authorized by preparation or by a passing
preflight. The operator must obtain explicit approval immediately before the
first passkey-confirmed funding transaction.
