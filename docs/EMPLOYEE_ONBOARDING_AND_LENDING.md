# Employee onboarding and lending experience

## Employee journey

An authenticated employee starts at `/app`. The dashboard reads the employee's
organization from the server session and shows setup guidance, wallet state,
borrowing capacity, eligible offers, active loans, repayments, and pending
blockchain operations. `/app/onboarding` expands the first-use checks without
exposing policy-engine or wallet secrets.

The onboarding states are:

- **Setup required** — no Circle wallet has been enrolled.
- **Pending** — wallet enrollment is still being verified.
- **Eligible** — employment, policy, borrowing capacity, and wallet checks pass.
- **Ineligible** — employment or the existing policy/capacity rules do not pass.
- **Temporarily unavailable** — borrowing is disabled or a wallet operation
  failed in a non-recoverable state.

The Circle wallet panel provides setup, continuation, recovery, and reconnect
actions according to the persisted wallet state. It never renders credentials,
recovery material, or server-only configuration.

## Existing services reused

The pages call the existing employee identity, borrowing-capacity, marketplace,
loan-query, Circle wallet, acceptance-intent, repayment-intent, receipt
verification, and Arc reconciliation modules. Amounts and eligibility are read
from those backend services; the browser does not introduce a second financial
calculation or lending decision engine.

Marketplace queries now require an active employee membership. The server-side
acceptance and repayment routes remain authoritative: they derive the user and
organization from the authenticated session, verify membership and loan/offer
ownership, and verify the Arc transaction receipt before confirming database
state. Browser-supplied employee and organization identifiers are not accepted.

## Interrupted transactions

Before requesting an intent, the browser stores the generated idempotency key in
`localStorage`, scoped by operation type and offer or loan. After Circle returns
a transaction hash, the hash and server operation ID are stored immediately.
Reopening the same offer or loan exposes **Resume confirmation** and calls the
existing confirmation endpoint; it does not submit a second blockchain
transaction. A confirmed operation removes only its own recovery entry.

If the browser closes before a transaction hash is returned, the same request ID
resumes the idempotent server intent. If local browser storage is unavailable or
lost, Arc reconciliation remains the authoritative recovery path for a
submitted on-chain transaction. The dashboard lists database operations still
awaiting confirmation so the employee does not mistake submission for success.

Submitted transactions are always displayed as pending until the backend has
verified a successful receipt. Failed/reverted receipts remain unsuccessful;
the UI never treats wallet submission alone as confirmation.

## Verification

The automated employee experience tests cover onboarding-state distinctions and
browser recovery persistence. Existing suites cover session/role authorization,
organization isolation, offer ownership and visibility, idempotent acceptance,
pending/confirmed/reverted receipt handling, loan queries, repayment initiation,
and reconciliation duplicate prevention.

Run the same local checks from the repository root:

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Database-backed tests require the configured disposable/local PostgreSQL
database to be running and all migrations deployed:

```powershell
docker compose up -d postgres
npm run prisma:deploy
npm run prisma:status
```

## Testnet limitations

Automated tests mock Circle and Arc RPC responses. They prove state transitions,
authorization, idempotency, and reconciliation behavior, but do not constitute a
live Circle passkey or Arc Testnet browser transaction. A pilot still requires
valid Circle client configuration, an Arc Testnet deployment, funded test
wallets, and an operator running or scheduling Arc reconciliation.
