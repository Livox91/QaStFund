# P2P lending security and end-to-end audit

Date: 2026-10-05

## Scope and conclusion

This review inspected the application boundaries, Prisma schema and migrations,
API mutation routes, authentication and tenant guards, wallet enrollment,
funded-offer and repayment flows, reconciliation worker, ERPNext integration,
and `EmployeeLendingEscrow` contract. It also adds a local-chain/database
lifecycle test and a read-only deployed-state audit command.

No critical or high-severity authorization or accounting defect was confirmed
in the reviewed paths. Three defense/consistency defects were fixed: a
suspended employee could still read a funded-offer quote, the loan-acceptance
confirmation endpoint lacked the rate limit used by the other financial
confirmation endpoints, and second-precision chain activation/repayment
timestamps could violate the millisecond-precision database lifecycle ordering
constraint.

This is automated review evidence, not a claim that the system is production
ready or that the Solidity code has received an independent professional
audit. The configured Arc pilot remains blocked until an escrow is deployed,
funded test identities exist, Circle passkey configuration is exercised, and
reconciliation is enabled.

## Implemented behavior verified

| Area                             | Result                                                 | Evidence and limits                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employer organization setup      | Implemented                                            | Registration creates the organization, administrator membership, and session atomically. Database tests cover duplicate rollback and tenant isolation.                                                                                               |
| Employee account creation/join   | Implemented through ERPNext invitations                | Sync creates an inactive mapped membership and one expiring invitation. Acceptance validates the hashed token, mapped employee, organization, and exact official email before activating access.                                                     |
| Authentication and authorization | Implemented                                            | Opaque server-side sessions, role guards, exact-origin mutation checks, scrypt password hashing, password change/reset, session revocation, and organization-scoped repository queries are present.                                                  |
| Employee management              | Implemented for mapped employees                       | Employers can inspect current/former employees and resend or revoke pending invitations. Unmatched or invalid ERPNext records remain review items.                                                                                                   |
| Wallet enrollment                | Implemented; provider integration not live-tested here | Circle usernames are stable per user. Enrollment records partial/recoverable state, and activation requires a short-lived challenge bound to organization, user, network, address, and signature. A unique address constraint prevents reassignment. |
| Funded offer                     | Implemented                                            | The server validates membership, policy, wallet, balance, receipt, contract address, and exact `OfferCreated` fields before marking an offer funded.                                                                                                 |
| Marketplace and acceptance       | Implemented                                            | Only same-organization, funded, active, eligible offers are returned. Acceptance uses a short-lived EIP-712 server authorization and verifies receipt plus final contract state.                                                                     |
| Repayment                        | Implemented as full on-chain repayment                 | The borrower approves and repays the exact contract obligation. Receipt, event fields, and final contract state are checked before the database becomes `REPAID`. Partial on-chain repayment is not implemented.                                     |
| Employer monitoring              | Implemented                                            | Organization-scoped loan monitoring, deterministic decision rules, review records, and a side-effect-free mock action adapter are present.                                                                                                           |
| ERPNext synchronization          | Optional and implemented read-only                     | Credentials are server-only, URLs are constrained against SSRF, syncs are bounded and leased, and synchronized identities remain inactive until voluntary invitation acceptance.                                                                     |
| Reconciliation                   | Implemented                                            | The worker handles provisional/finalized events, retries, reorgs, conflicts, unmatched events, cursor leases, and idempotent application. The new audit command compares state without writing.                                                      |

## End-to-end lifecycle evidence

`tests/p2p-lending-local-e2e.test.ts` uses an ephemeral Hardhat chain and the
real PostgreSQL repositories. It:

1. registers an employer and organization through the registration use case;
2. creates Alice and Bob as explicit fixtures so the test can focus on the
   lending lifecycle; invitation onboarding is covered separately by the
   ERPNext database suite;
3. enrolls distinct Alice and Bob addresses through the real challenge and
   signature-verification flow;
4. deploys `MockUSDC` and `EmployeeLendingEscrow` locally;
5. mints test-only USDC to Alice, creates the application funding intent,
   funds the real contract, and confirms the receipt;
6. proves Bob can discover Alice's eligible offer;
7. signs the same EIP-712 authorization used in production, accepts the offer,
   and confirms Bob received the exact principal;
8. gives Bob only the interest needed for settlement, repays the exact amount,
   and confirms Alice received principal plus interest; and
9. verifies the contract is `REPAID`, the database is `REPAID`, outstanding
   principal is zero, one completed repayment exists, and escrow holds no
   residual funds.

The scenario uses no production key, provider credential, employee record, or
fund.

## Security findings

### Fixed — medium: suspended membership data exposure

`findBorrowableOffer` checked active membership and lending flags but omitted
`employmentStatus` for both borrower and lender. A suspended employee could
open a funded-offer quote even though the later acceptance path rejected it.
The read query and reservation predicate now require active employment. A
database regression test covers suspended borrowers and lenders.

### Fixed — low: missing confirmation rate limit

`POST /api/loans/[id]/acceptance/confirm` had trusted-origin and employee
authorization checks but no user rate limit. Repeated requests could amplify
receipt RPC and database work. It now uses the same sensitive-operation rate
limit class as the other financial intent/confirmation endpoints.

### Fixed — medium: chain/application timestamp precision conflict

Acceptance and repayment events report whole-second timestamps, but PostgreSQL
records requests and intents with millisecond precision. When events occurred
in the same second, confirmation could try to store `approvedAt` before
`requestedAt` or `closedAt` before activation, causing the database lifecycle
constraint to reject an otherwise valid confirmation. Exact event values
remain in `onChainStartedAt` and `onChainRepaidAt`; application lifecycle fields
are now clamped to monotonic request/activation/intent times. The integrated
lifecycle test exposed and now covers these boundaries.

### Medium operational risks — unresolved

- The escrow's authorization signer is immutable. Rotation after compromise or
  loss requires deploying a new escrow and updating configuration. Existing
  active offers must be handled operationally.
- The contract has no pause, rescue, or signer-governed emergency mechanism.
  This reduces administrator custody but also removes an incident-response
  control. Any future emergency feature needs an explicit governance and threat
  model, not an unaudited owner backdoor.
- The contract supports lender cancellation, but the application has no funded
  offer cancellation transaction flow. A funded offer remains reserved until
  accepted or cancelled directly by its lender wallet.
- `DEFAULTED` is an application-side classification. The current contract has
  no function that transitions a loan to its `DEFAULTED` enum value, so a
  defaulted application loan remains `ACTIVE` on chain.

### Low / defense-in-depth risks — unresolved

- A dedicated `RATE_LIMIT_HASH_SECRET` is recommended but not required by base
  startup validation; local development falls back to `DATABASE_URL` as the
  HMAC key. Deployed environments should enforce a separate managed secret.
- No explicit Content-Security-Policy is configured. Adding one requires a
  Next.js-compatible nonce/hash design and testing with the Circle wallet SDK.
- The dependency-health response exposes aggregate operational counts. It does
  not expose credentials, but production ingress should decide whether those
  metrics should remain public.
- Circle passkey relying-party/origin configuration lives partly outside this
  repository. The configured production hostname must be verified in Circle
  Console; unit tests cannot prove that external setting.
- The audit was source/test based. It did not include formal verification,
  fuzzing, third-party dependency penetration testing, or an independent
  Solidity audit.

## Authorization and financial regression coverage

The existing and added tests cover cross-organization offer/loan access,
borrow-request identity binding, employer/employee role guards, wallet address
uniqueness, session revocation, exact request origins, authorization replay,
offer double acceptance, concurrent application intents, duplicate receipts
and events, reverted receipts, wrong borrowers, duplicate repayment, integer
USDC base units, fee rounding, database unique constraints, reconciliation
reorg/conflict handling, and restored-database idempotency.

The contract uses `SafeERC20` and `ReentrancyGuard`, validates exact token
balance deltas on funding, consumes request/authorization IDs once, prevents
self-borrowing, and permits repayment only by the recorded borrower while the
loan is active. For cent-denominated principals, application cents and six
decimal USDC base units remain exact; positive fractional-base-unit interest is
rounded up identically by the application and contract.

## Files changed for this milestone

- `tests/p2p-lending-local-e2e.test.ts`: integrated local chain/database
  lifecycle.
- `tests/onchain-borrow-organization.test.ts`: suspended borrower/lender
  regression.
- `src/modules/loans/infrastructure/prisma-borrow-loan-repository.ts`: aligned
  employment-state authorization.
- `src/app/api/loans/[id]/acceptance/confirm/route.ts`: added sensitive user
  rate limiting.
- `src/modules/lending/application/funded-lending-offer.ts`,
  `src/modules/loans/application/onchain-borrow.ts`, and
  `src/modules/loans/application/onchain-repayment.ts`: dependency seams for
  local-chain verification; default runtime behavior is unchanged.
- `scripts/audit-arc-reconciliation.ts`, `package.json`, and the reconciliation
  README: bounded read-only deployed-state check and command.
- This report.

No migration, public API shape, contract economic term, or fee was changed.

## Reproduce locally

Start the repository's PostgreSQL database, configure `DATABASE_URL` and
`APP_URL`, apply migrations, then run:

```powershell
npm run prisma:deploy
npx vitest run tests/p2p-lending-local-e2e.test.ts
npm test
npm run test:contracts
npm run typecheck
npm run lint
```

For a deployed Arc escrow, configure its address and RPC, then run:

```powershell
npm run audit:arc
```

`audit:arc` is read-only. It checks the RPC chain, canonical token, optional
expected authorizer, transaction receipts, up to 500 linked offers and loans,
reconciliation journal exceptions, and intents pending for more than 15
minutes. It exits non-zero on discrepancy and never submits a transaction or
changes a database record. In the current local configuration it correctly
stops because no deployed escrow address is configured.

## Verification results

| Command                   | Result                                                         |
| ------------------------- | -------------------------------------------------------------- |
| `npm test`                | PASS — 45 files passed, 1 skipped; 288 tests passed, 1 skipped |
| `npm run test:contracts`  | PASS — 22 contract tests                                       |
| `npm run typecheck`       | PASS                                                           |
| `npm run lint`            | PASS                                                           |
| `npm run format:check`    | PASS                                                           |
| `npm run build`           | PASS — Next.js production build completed                      |
| `npm run prisma:validate` | PASS                                                           |
| `npm run prisma:status`   | PASS — 30 migrations found; database up to date                |
| `npm run audit:arc`       | BLOCKED AS EXPECTED — no deployed escrow address configured    |
