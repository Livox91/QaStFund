# Arc Testnet end-to-end pilot report

Date: 2026-10-10 (Asia/Karachi)

Repository revision: `dae16664818803cc4a5bd03d7153bfbc03b1800d`

Result: **BLOCKED ON WALLET FUNDING/RECONCILIATION FRESHNESS — NO FINANCIAL TRANSACTION SUBMITTED**

This run stopped at the mandatory preflight boundary. PostgreSQL is healthy,
all migrations are current, and two distinct ownership-verified Circle wallets
are active. Both wallets have zero ERC-20 USDC and zero native fee balance, and
the reconciliation cursor is stale. No offer was created or funded, no loan was
borrowed, and no repayment was submitted. Local or mocked results below are not
presented as Arc Testnet lifecycle evidence.

## Environment and preflight

| Check               | Evidence                                                                                                                                                                                                                                      | Result  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Network             | Arc Testnet RPC `https://rpc.testnet.arc.io` returned chain ID `5042002` and block `66502473` during the latest preflight                                                                                                                     | PASS    |
| Escrow deployment   | Contract `0x46c4a0a877e6967542078A580468b80195c466cC` has bytecode; deployment transaction `0xde944502a1c26c7a647c39665c6ed8dc973f615c7aa1f690be1d2d4dc8fdf00d` succeeded at block `66108453` and its receipt matches the configured contract | PASS    |
| USDC                | Canonical token `0x3600000000000000000000000000000000000000` has bytecode, reports 6 decimals, and is the token bound to the escrow                                                                                                           | PASS    |
| Borrow authorizer   | Server-derived signer, configured public signer, and `authorizationSigner()` all match `0xa9200E14C8BeA07187368232455b2b1c8F2Bc63f`                                                                                                           | PASS    |
| Circle Arc RPC      | The configured Circle client was accepted and returned Arc Testnet chain ID                                                                                                                                                                   | PASS    |
| Database            | PostgreSQL container is healthy and Prisma connected successfully                                                                                                                                                                             | PASS    |
| Migrations          | Prisma found 37 migrations and reported the schema up to date                                                                                                                                                                                 | PASS    |
| Reconciliation      | Enabled from deployment block `66108453`; the read-only preflight reported that the persisted cursor is stale and requires a separately reviewed reconciliation run                                                                           | BLOCKED |
| Pilot wallets       | Two distinct active users and addresses have consumed exact user/address ownership challenges                                                                                                                                                 | PASS    |
| Wallet funding/fees | Both verified wallets report 0 ERC-20 USDC and 0 native fee balance                                                                                                                                                                           | BLOCKED |
| Test-only isolation | The configured chain and token are Arc Testnet values; no transaction was sent. Credential provenance cannot be proven from configuration alone                                                                                               | PARTIAL |
| ERPNext             | Explicitly disabled for the pilot                                                                                                                                                                                                             | PASS    |
| Rate-limit secret   | Present and passed the repository strength check without being printed                                                                                                                                                                        | PASS    |

The escrow's observed USDC balance after the halted run was `0` base units.

## Offer funding evidence

- Lender public wallet: not yet designated; two verified candidate wallets are enrolled.
- Offer/database identifier: none created.
- Funding transaction hash and block: none; no transaction was submitted.
- Contract/application comparison: not possible.

## Borrowing evidence

- Borrower public wallet: not yet designated; two verified candidate wallets are enrolled.
- Employer membership, eligibility, capacity, and policy: not verified.
- EIP-712 authorization: not generated. The deployed contract's chain,
  verifying contract, and signer bindings passed preflight, but nonce and expiry
  were not exercised.
- Borrow transaction hash, block, and loan identifier: none.

## Repayment evidence

- Outstanding amount: no pilot loan exists.
- Repayment transaction hash and block: none; no transaction was submitted.
- Final loan state: no pilot loan exists.

## On-chain/database reconciliation

No lifecycle events were produced. A read-only scan found zero escrow logs from
deployment block `66108453` through block `66494350`. The explicit catch-up and
follow-up reconciliation passes observed and applied zero events and changed
only reconciliation operational state (cursor/lease/run health). Database
records, ledger entries, user and organization associations, event identifiers,
state transitions, principal, repayment amounts, and token transfers therefore
could not be compared. The database is healthy and the wallets are enrolled,
but there are no pilot lifecycle records to reconcile.

## Restart and idempotency results

Initial catch-up and a normal reorganization-window follow-up completed without
events. A scheduler-driven restart was not exercised. Real duplicate-request, pending
transaction recovery, and reverted-transaction behavior remain unverified on
Arc Testnet. Automated contract tests cover authorization replay, duplicate
acceptance, duplicate repayment, wrong borrower, failure rollback, and exact
repayment; these are supporting tests only, not live acceptance evidence.

## Tests passed and failed

| Command                   | Result                                                        |
| ------------------------- | ------------------------------------------------------------- |
| Focused portability tests | PASS: 8 files, 49 tests                                       |
| `npm run test:arc-live`   | PASS: 1 file, 2 tests; Circle RPC and Arc deployment bindings |
| `npm run test:contracts`  | PASS: 22/22 contract tests                                    |
| `npm test`                | PASS: 53 files passed, 1 skipped; 325 tests passed, 1 skipped |
| `npm run lint`            | PASS                                                          |
| `npm run typecheck`       | PASS                                                          |
| `npm run build`           | PASS                                                          |
| `npm run format:check`    | PASS; the safe YAML-only formatting deviation was corrected   |
| `npm run prisma:status`   | PASS: all 37 migrations applied                               |
| `npm run pilot:preflight` | FAIL: stale reconciliation and zero token/native balances     |

## Defects fixed

- The preflight no longer starts the database-writing reconciliation worker;
  it validates persisted health and bounded cursor lag read-only.
- Ownership evidence now must match the exact organization, user, and address
  tuple instead of independently matching a user and an address.
- The preflight now reads both ERC-20 USDC and native Arc fee balances and
  reports each prerequisite independently.
- Arc wallets are now owned by the global user rather than deleted or rejected
  at an organization boundary. A former employee can reconnect the same
  passkey wallet after joining a new organization, with a fresh signed proof.
- The wallet UI now exposes the complete public address, copy and Explorer
  actions, and a read-only `/wallet-access` page that does not require an active
  organization session.
- ERPNext provisioning can reuse an inactive former employee identity while
  retaining review protection for identities that are still active elsewhere.
- `npm run reconcile:arc` now loads `.env` consistently with the other operator
  scripts.
- Stale `.env.example` reconciliation/RPC defaults and the unrelated
  `compose.production.yaml` formatting deviation were corrected.

## Remaining blockers and risks

1. Fund both public wallet balances with only the minimum required testnet
   USDC/fees.
2. Run the explicitly reviewed reconciliation command and confirm the cursor is
   fresh.
3. Confirm the configured keys are dedicated testnet credentials. No secret was
   printed or copied into this report.
4. Keep the scheduler invoking authenticated reconciliation often enough to
   remain within the configured block range and stale-time threshold.
5. Rerun the entire preflight. Do not submit a lending transaction until every
   check passes.
6. The read-only wallet-access page depends on the existing synced passkey,
   Circle client, and configured passkey domain. Circle recovery-signer setup is
   still a separate production-hardening requirement; the application does not
   generate or retain recovery phrases.

Security properties such as tenant isolation, wallet association enforcement,
authorization replay protection, and authoritative receipt handling passed
automated coverage where applicable, but were not validated by this halted live
run. This report is not an independent security audit.

## Recommendation for the next milestone

Do not advance the pilot milestone yet. Fund the two enrolled Circle wallet
identities with the minimum intended Arc Testnet ERC-20 USDC and native fee
balances, refresh reconciliation, and rerun `npm run pilot:preflight`. Only a fully passing
preflight should be followed by offer creation, separate-borrower acceptance,
repayment, reconciliation restart/replay, and final chain/database evidence
capture required for acceptance.
