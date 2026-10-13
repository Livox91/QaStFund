# QastFund presentation

## 1 — Employer-integrated financing for verified employees

QastFund connects workforce eligibility, conservative human review, peer-funded
loans, employee-controlled wallets, and auditable settlement.

Accepted scope: two-user, test-fund-only Arc Testnet validation pilot.

## 2 — The problem

- Employees may lack a trustworthy, portable way to demonstrate current
  employment when requesting short-term financing.
- Lenders need clear terms, repayment visibility, and protection from duplicate
  transaction execution.
- Employers need a narrow eligibility and review role without taking custody of
  employee funds.
- Operators need to explain how application records agree with blockchain
  receipts and how failures are recovered.

## 3 — The QastFund solution

- Read-only ERPNext employee synchronization establishes eligibility evidence.
- Deterministic policy rules fail closed or require manual review; no trained
  credit model or automatic score-based approval is claimed.
- Employer administrators record organization-scoped approval or rejection.
- Circle passkey wallets keep transaction authorization with employees.
- Arc Testnet escrow and finalized-event reconciliation link settlement to the
  internal ledger.

## 4 — Architecture

```text
Employee / lender browser       Employer administrator browser
             \                         /
              HTTPS + secure sessions
                         |
                       Caddy
                         |
                Next.js application
             /       |        |       \
       PostgreSQL  ERPNext   Circle   Arc Testnet
           ^        read      wallet     escrow
           |                              |
           +------- receipt/event reconciliation
```

Trust boundaries:

- browser input never establishes authorization;
- route and service layers enforce role and organization scope;
- employer approval cannot sign a wallet transaction;
- wallet submission is not completion without verified receipt evidence;
- ERPNext payroll writeback is not configured.

## 5 — Employee and lender workflow

1. A mapped employee signs in.
2. A lender creates and funds a bounded offer.
3. A borrower selects a permitted partial amount and repayment term.
4. The application records the request before any wallet action.
5. After authorized review, the borrower controls acceptance with a passkey.
6. Repayments update history and outstanding balances only after the applicable
   confirmation boundary.

Local demonstration screens: My Lending, Marketplace, and the versioned
installment schedule. See the [capture checklist](screenshots/README.md).

## 6 — Employer workflow

- Inspect ERPNext synchronization and unresolved mappings.
- Review deterministic decision evidence and enter a rationale.
- Inspect payroll proposals with separate employee consent and employer
  approval states.
- Review overdue or partially paid installments and auditable notification
  history.
- Monitor transaction, scheduler, reconciliation, and incident state.

Payroll display is a proposal workflow, not evidence of an ERPNext deduction.

## 7 — Arc Testnet and reconciliation

- Existing controlled lifecycle: offer funding, authorized acceptance,
  disbursement, full repayment, and receipt verification.
- Recorded audit: 3 offers, 3 loans, 8 verified receipts, zero journal problems,
  and zero stale intents at audit time.
- Idempotency keys, consumed authorizations, transaction hashes, and canonical
  event keys reduce replay and duplicate-processing risk.
- Unmatched or conflicting events remain visible for investigation rather than
  silently rewriting financial state.

The local installment fixtures are not presented as Arc transactions. The
current recorded preflight is NOT READY until the stale reconciliation cursor
is caught up through an authorized bounded reconciliation run.

## 8 — Demonstrated controls

- Employee/admin role and tenant boundaries.
- Exact-origin checks for state-changing browser requests.
- Checked-in dependency-health bearer authentication and a public-proxy deny
  rule for internal scheduler routes. These controls pass local tests, but the
  live deployment has not yet received them.
- Duplicate intent/event protections and failure-recovery tests.
- Isolated PostgreSQL backup and restore verification.

## 9 — Verified engineering results

- Current isolated application regression: 447 passed, 1 skipped across 74
  files; its disposable database was removed after the run.
- Contract regression: 29/29 passed.
- Typecheck, lint, formatting, Prisma validation/status, and production build
  passed.
- Milestone 5 local verification: demo accounts authenticated; employee,
  employer, payroll, delinquency, and monitoring pages/APIs returned `200`;
  employee access to an employer page redirected to `/app`.
- Demo preparation was run twice with stable record counts.

## 10 — Current limitations and roadmap

Still required before broader release:

- managed signer custody and rehearsed replacement/wind-down;
- target-host restore, rollback, Arc replay, and measured RPO/RTO;
- Circle production origin, callback, key, and recovery assurance;
- upstream-compatible remediation for remaining dependency advisories;
- deployment of the checked-in health-route/Caddy hardening: the final public
  probe still returned `200` for unauthenticated dependency health and `405`
  rather than the configured edge `404` for an internal scheduler route;
- independent application/contract security review;
- legal, privacy, consent, retention, servicing, and complaints approval.

Decision: the historical acceptance remains evidence for the completed
two-user, test-fund-only Arc Testnet validation. A new live pilot transaction is
currently NO-GO until an authorized reconciliation catch-up and passing
preflight. External/public lending and production financial operations remain
NO-GO.
