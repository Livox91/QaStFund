# QastFund 5–7 minute demonstration

This walkthrough uses deterministic local fixtures for product screens and the
frozen Arc Testnet report for blockchain evidence. Local fixture records are
illustrative; they are not represented as live transactions or ERPNext payroll
writes.

## Before the audience joins

1. From the repository root run `npm run demo:start`.
2. In another terminal run `npm run demo:data -- --check`.
3. If the check reports missing fixtures, deliberately run
   `npm run demo:data -- --confirm=local-qastfund-demo`, then check again.
4. Open `http://localhost:3000` in two browser profiles.
5. Sign in with the development-only accounts from `docs/README.md`:
   employee `alice@acme.test`, employer `admin@acme.test`.
6. Keep `docs/ARC_TESTNET_PILOT_REPORT.md` and
   `docs/CONTROLLED_PILOT_READINESS.md` open as the transaction-evidence
   fallback. Do not open `.env` or unredacted logs while sharing the screen.

Expected preflight: the startup command reports an up-to-date schema and `OK`
for liveness, readiness, and sign-in. The data check reports at least four demo
users, three offers, six loans, three repayment plans, one payroll proposal,
and one delinquency case.

## 0:00–0:40 — Problem and scope

Navigate to `/`.

Say: “QastFund gives verified employees access to colleague-funded financing
without making the employer a fund custodian. ERPNext establishes employment
eligibility, an employer administrator reviews requests, and employees retain
control of their passkey wallets.”

State the boundary: technical GO is limited to the existing two-user,
test-fund-only Arc Testnet validation pilot. Public lending and real-money
operations remain NO-GO.

## 0:40–1:25 — Employment evidence

In the employer profile open **Integrations** (`/employer/integrations`), then
**Employees** (`/employer/employees`).

Say: “The implemented ERPNext adapter reads employee records, maps them to an
organization, and surfaces ambiguous or incomplete mappings for review. It
does not write payroll documents or move funds.”

Expected result: the integration and mapped local fixture records render. The
placeholder local integration is visibly not live ERPNext evidence. For the
verified external result, cite the frozen readiness evidence: 3/3 mappings,
fresh scheduled success, and no review records.

## 1:25–2:10 — Lender offer and borrower choice

In the employee profile open **My Lending** (`/app/lending`) and point out total,
accepted, available, disbursed, outstanding, and repaid amounts. Then open
**Marketplace** (`/app/borrow`).

Say: “An offer can be accepted in a permitted partial amount. The application
validates the offer range and calculates terms before any wallet operation.”

Expected result: funded offers and the borrow marketplace render. Do not fund
or accept an offer during the default demonstration.

## 2:10–3:00 — Decision and authorization boundary

Open **Loans** in the employer profile (`/employer/loans`) and select the seeded
requested or approved application.

Say: “QastFund does not claim an ML credit model. Deterministic rules produce
fail-closed or review-required outcomes. An employer administrator records an
auditable review and rationale, but approval does not itself disburse money.”

Expected result: request status, decision evidence, and reviewer boundary are
visible. Use the existing fixture; do not create or approve a new request in
the presentation database.

## 3:00–4:00 — Repayment schedule and partial repayment evidence

Return to Alice and open
`/app/loans/22000000-0000-4000-8000-000000000001`.

Say: “The local workflow stores a versioned installment plan, repayment
history, oldest-first allocations, outstanding principal, and the exact
remaining balance. This loan illustrates a partial repayment without modifying
the successful Arc lifecycle.”

Expected result: **Installment schedule**, repayment history, progress, and
remaining balance are visible. Clarify that partial installments are local
ledger functionality; the deployed Arc V1 evidence used exact full acceptance
and repayment.

## 4:00–4:45 — Payroll proposal, not a payroll deduction

Open `/employer/payroll`.

Say: “This is a proposed payroll deduction. Employee authorization and employer
approval are separate controls. The current ERPNext integration is read-only,
so QastFund must not claim that this proposal was written to payroll.”

Expected result: one `PROPOSED`, `NOT_RECORDED` fixture for 420.00 USD is shown.
Do not submit it to an external system.

## 4:45–5:25 — Overdue operations

Open `/employer/delinquency`.

Say: “A separate fixture demonstrates a partially paid installment with 60.00
USD outstanding and 24 days overdue. Employer actions create auditable review,
contact, or arrangement-request records; they cannot trigger employment action.”

Expected result: one open `PARTIALLY_PAID` case, outstanding balance,
notification status, and recommended action render. Do not send a notification
during the default walkthrough.

## 5:25–6:20 — Arc settlement and reconciliation evidence

Open `docs/ARC_TESTNET_PILOT_REPORT.md`, then the evidence index in
`docs/CONTROLLED_PILOT_READINESS.md`.

Say: “These are the verified Arc Testnet results, not local fixtures: three
offers, three loans, eight verified receipts, and no stale intents or journal
problems in the recorded audit. QastFund binds transaction intent before
submission and treats a wallet submission as pending until the canonical
receipt and contract event are verified.”

Also state that the latest recorded preflight became NOT READY because its
reconciliation cursor was stale. Do not describe the older READY result as a
current pass.

## 6:20–7:00 — Close

Say: “The demonstrated value is employer-backed eligibility, human-controlled
approval, employee-controlled wallets, and receipt-to-ledger reconciliation.
The next gates are managed signer custody, target-host recovery rehearsal,
Circle console assurance, dependency remediation, and independent security,
legal, and privacy review.”

Repeat the scope: two users, test funds, Arc Testnet only.

## Recovery path

- Application unavailable: rerun `npm run demo:start`; do not reset the volume.
- Fixture check fails: use the explicit confirmed `demo:data` command. It is
  restricted to approved local database names and local hosts.
- Circle, Arc, or ERPNext unavailable: stop interactive external steps and use
  the frozen reports. Label local records as fixtures.
- Ambiguous wallet result: preserve the operation identifier/hash and stop. Do
  not retry, replace, edit the database, or claim completion.
- Screenshot unavailable: follow `submission/screenshots/README.md` for manual
  capture. Do not substitute generated or fictional screens.
