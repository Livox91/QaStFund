# QastFund submission demonstration runbook

Last reviewed: 2026-10-13 (Asia/Karachi)

## Scope and safety boundary

This runbook demonstrates the accepted **two-user, test-fund-only Arc Testnet
validation pilot**. It does not authorize a contract deployment, new
participant, real-money transaction, production configuration change, or
destructive recovery operation.

The default submission demonstration is read-only and uses the already recorded
Arc lifecycle. Any step that opens a Circle passkey prompt or submits a user
operation is optional and requires explicit authorization at demonstration
time. Closing or cancelling the prompt must leave the persisted intent
recoverable; never improvise a replacement transaction.

Do not show `.env` files, private keys, session cookies, bearer tokens, Circle
recovery material, ERPNext credentials, employee source records, database
connection strings, or unredacted logs on screen.

## Roles

| Role                   | Responsibility                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| Presenter              | Narrates the product and drives the UI.                                                             |
| Employer administrator | Runs/inspects employee sync and records the immutable application review.                           |
| Lender                 | Owns the funded offer and authorizes offer funding if a live testnet action is separately approved. |
| Borrower               | Applies, returns after review, and controls borrowing/repayment through a passkey.                  |
| Operator               | Runs sanitized health/audit commands and stops the demo on an abort condition.                      |

For the live pilot, use only the two already approved accounts and their bound
wallets. Obtain their identifiers from the private operator brief, not from
slides, terminal history, or this document. For a fully local demonstration,
use the development-only seed accounts documented in `docs/README.md`.

## Prerequisites

Before presenting, confirm without printing values:

- the intended environment is Arc Testnet (`chainId=5042002`) and uses the
  documented canonical testnet USDC and existing escrow;
- `APP_URL` matches the browser origin and the site is available through HTTPS;
- the application, PostgreSQL, scheduler, Arc RPC, Circle client, and ERPNext
  source are available;
- the two pilot memberships are active, mapped by a fresh ERPNext sync, and
  have distinct ownership-verified Circle wallets;
- the existing escrow signer, deployment receipt, reconciliation cursor, and
  configured contract agree;
- the designated testnet wallets have only the approved test-fund exposure;
- the presenter has separate authenticated browser profiles for employee and
  employer roles, with notifications and password-manager overlays disabled;
- no screen-sharing surface contains secrets or personal data.

Safe readiness commands for the configured pilot environment are:

```powershell
npm run audit:erpnext
npm run audit:arc
npm run pilot:preflight
```

These commands are expected to print sanitized summaries only. Stop if any
command exits non-zero, reports stale/unmatched/conflicting state, or does not
end in the expected readiness result. Do not run deployment, funding,
reconciliation repair, restore, or transaction commands to make the demo pass.

For a local presentation environment, start the disposable database and app
using the root README. Confirm `GET /api/health/ready` returns `status=ready`.
Local seed data is representative UI data, not live Arc evidence.

### Submission-sprint verification record

On 2026-10-13, the following non-transactional checks were completed from the
submission workstation after Docker Desktop and PostgreSQL became available:

- local and production Compose definitions parsed successfully with
  `docker compose config --quiet`;
- `https://qastfund.com/` and `/api/health` returned `200`, TLS certificate
  verification succeeded, and HTTP returned a `308` redirect to HTTPS;
- `npm run audit:erpnext` passed with one connected integration, a successful
  scheduled sync, 3/3 active mappings matched, and no review diagnostics;
- `npm run audit:arc` passed with 3 offers, 3 loans, 8 verified receipts, zero
  journal problems, and zero stale intents;
- preflight reached Arc Testnet at block `66982613`, accepted the Circle Arc RPC
  credentials, verified the existing escrow deployment/USDC binding, and found
  the configured, server-derived, and on-chain signer addresses equal;
- preflight nevertheless ended `NOT READY FOR PILOT` because the persisted Arc
  reconciliation cursor was stale. No catch-up was run merely to make the check
  green because `reconcile:arc` writes reconciliation state;
- the local HTTP readiness route returned `200` with healthy configuration and
  database checks. Authenticated employee lending/borrow routes, employer
  payroll/delinquency/loan routes, and their list APIs returned `200`;
- interactive browser clicking was not available in the verification session,
  so visual layout, passkey prompts, and client-side interaction remain a
  presenter dry-run requirement.

The successful 2026-10-12 evidence freeze remains historical acceptance
evidence; it must not be presented as a current preflight pass. Before any live
Arc action, an operator must review and run the bounded reconciliation catch-up,
then rerun the read-only audit and preflight. If that approval is not available,
use the read-only evidence walkthrough.

## Demonstration sequence

### 1. Introduce the problem and scope

Open the public home page. Explain that QastFund connects verified employees,
employer-controlled eligibility, and user-controlled testnet wallets. State the
scope before showing the workflow:

- GO: two existing users, test funds, Arc Testnet validation only.
- NO-GO: public/external lending and production financial operations.

Expected result: the audience understands that the demo is technical evidence,
not a public financial launch or regulatory approval.

### 2. Show employee synchronization

Sign in as the employer administrator and open `/employer/integrations`.

1. Show the configured ERPNext integration status, last successful sync,
   freshness, processed/matched counts, and review count.
2. Show that the integration reads employee data and cannot write payroll,
   deduct salary, or move funds.
3. If a manual synchronization is required for the demo, run it only through
   the existing employer UI after confirming the source is the approved
   read-only test integration. Otherwise, use the recorded fresh scheduled
   result.
4. Open `/employer/employees` and show eligibility state without revealing
   unnecessary employee details.

Expected result: the latest complete sync is successful and fresh, all expected
pilot mappings are resolved, and there are no unresolved review records. A
failed, partial, stale, or unexpectedly changed directory is an abort condition.

### 3. Show the funded offer

In the employee/lender profile, open `/app/lending`. For the default read-only
demo, show the existing recorded offer and explain its Arc funding receipt.

If a new live testnet funding action was explicitly authorized, follow the
fixed limits and exact transaction steps in
`ARC_TESTNET_CONTROLLED_LENDING_RUNBOOK.md`. Stop before the passkey prompt and
obtain the separate go-ahead. Do not reuse an idempotency key or retry with a
new operation after an ambiguous result.

Expected result: the selected offer is active, funded, belongs to the same
organization, and has a persisted chain offer ID and funding hash. The lender
view also separates pending applications, approved-but-not-reserved principal,
the zero reserved-money bucket, disbursed principal, repaid amounts,
outstanding balances, and repayment history.

### 4. Submit the loan application

Use the distinct borrower account, open `/app/borrow`, select the controlled
offer, and review `/app/borrow/{offerId}`.

1. Select **Confirm borrowing** once.
2. The application should be recorded before any wallet transaction.
3. The UI should report that employer review is required because required
   eligibility evidence is unavailable or unverified.
4. Confirm that no Circle passkey prompt appeared and no balance moved.

Expected result: one loan is `REQUESTED`, one immutable decision uses
`loan-decision-manual-review-v1`, `score` is not calculated, the outcome is
`REVIEW_REQUIRED`, and the audit trail includes the request. Repeating the same
request must return the same application rather than create a duplicate.

### 5. Perform authorized manual review

In the separate employer-admin session, open `/employer/loans?status=review`,
select the requested loan, and inspect the **Origination eligibility review**.

1. Show the decision version, `Not calculated` score, reason codes, requested
   terms, and organization scope.
2. Enter a 20–1000 character rationale that cites only evidence the reviewer
   actually inspected.
3. Choose **Approve request** for the approved demo path. Use **Reject request**
   only when demonstrating the rejection path on a separate disposable/local
   record.
4. Show the permanent reviewer identity, timestamp, outcome, and rationale.

Expected result: approval changes the application to `APPROVED` and records
`LOAN_APPROVED`, but does not display a transaction hash, open a passkey prompt,
or change wallet balances. A reviewer from another tenant or a non-admin role
must not be able to perform this action.

### 6. Demonstrate disbursement boundary

Return to the borrower session and select **Check review status** or **Continue
borrowing** on the same application.

For the default read-only demo, stop before authorizing a new wallet operation.
Use the existing loan detail, transaction record, and pilot report to explain
the verified outcome.

Only with explicit live-action authorization:

1. Confirm the server revalidated membership, ERPNext freshness, policy,
   exposure, wallet, offer, contract, and signer.
2. Verify the authorization is for the same offer and borrower and expires
   within five minutes.
3. Obtain the borrower's passkey confirmation for `acceptOffer`.
4. Wait for the underlying Arc receipt; never treat wallet submission alone as
   success.
5. Show that the application becomes `ACTIVE` only after exact
   `LoanStarted`, transfer, and contract-state verification.

Expected result: one acceptance hash is bound to the application, the offer is
exhausted, and the loan is active. A timeout remains pending/recoverable; it is
not evidence of failure or permission to resubmit.

### 7. Show repayment

Open `/app/loans/{loanId}`. For the default demonstration, show the already
recorded repaid loan, exact amount, transaction hash, and audit history.

Only with explicit live-action authorization, select the full repayment action,
verify the amount against the contract, approve the passkey prompt, and wait for
receipt verification. Partial/manual repayment routes are intentionally
disabled for the Arc flow.

Expected result: the repayment becomes `COMPLETED` and the loan becomes
`REPAID` only after `LoanRepaid`, transfer, and contract-state verification.
The lender receives the contract-defined amount, and the escrow does not retain
the repaid principal.

For the fully local demo, the illustrative seeded loans also show active one-,
two-, and three-installment plans, partial allocations, and remaining balances.
These local records demonstrate the internal-ledger workflow; they are not
evidence that the deployed Arc V1 escrow accepts partial repayments. The live
Arc V1 path remains exact full acceptance and full repayment.

### 8. Show payroll consent and reconciliation boundaries

Open an employee loan that has an eligible installment and show its payroll
proposal and explicit authorization state. Then open `/employer/payroll` in the
employer session.

1. Show that an unconsented proposal cannot be approved or submitted.
2. Show the employee authorization record separately from employer approval.
3. Explain that the configured ERPNext adapter is employee-directory read-only;
   live payroll writeback is blocked with
   `ERP_NEXT_PAYROLL_WRITE_NOT_CONFIGURED`.
4. Use only the seeded or tested reconciliation evidence to show that an actual
   partial deduction allocates once and leaves the remaining installment
   balance. Do not claim that an ERPNext payroll document was created.

Expected result: consent and employer approval are distinct, retry keys prevent
duplicate proposals/repayments, and the unavailable external write path fails
closed with a clear status.

### 9. Show overdue operations

Open `/employer/delinquency`. Show the outstanding amount, days overdue,
payroll state, notification history, and recommended action. Explain that
review, contact, and arrangement-request actions create auditable records but
cannot trigger an adverse employment action.

Expected result: partial payments reduce rather than clear the case, repeated
scheduler runs do not duplicate threshold alerts, a confirmed final allocation
resolves the case, and failed email delivery remains retryable.

### 10. Show reconciliation and audit evidence

Run the safe commands from the prerequisites section or show their frozen output
from the readiness report. Explain that finalized-event reconciliation is
idempotent and retains unmatched/conflicting events for investigation.

Expected frozen result:

- Arc audit: 3 offers, 3 loans, 8 receipts, zero journal problems, and zero
  stale intents.
- ERPNext audit: 3/3 mappings matched, fresh scheduled success, and zero review
  records.
- Frozen 2026-10-12 preflight: `READY FOR CONTROLLED ARC TESTNET PILOT`.
- Current 2026-10-13 preflight: `NOT READY FOR PILOT` because reconciliation
  health is stale; all other checks passed.

The Arc and ERPNext audit results above were rerun on 2026-10-13. Describe the
READY preflight only as the 2026-10-12 frozen result and the stale-cursor
failure as the current result until a later command run supersedes it.

## Abort and recovery rules

Stop the live path immediately if:

- the network, chain ID, escrow, USDC address, signer, wallet owner, or intended
  participant differs from the approved configuration;
- ERPNext data is stale, partial, failed, or contains unresolved mappings;
- a transaction amount or recipient differs from the approved display;
- the application and contract disagree, an event is unmatched/conflicting, or
  receipt verification is unavailable;
- a passkey prompt appears at an unapproved step;
- any secret or personal data appears on the shared screen.

For an ambiguous wallet result, preserve the operation ID and transaction hash,
close the interactive demo, and follow `OPERATIONS_AND_INCIDENT_RECOVERY.md`.
Do not delete the intent, edit the database, reset the cursor, or submit a new
transaction.

## Backup walkthrough when the live demo fails

The repository does not currently contain a verified screenshot set, demo
video, or presentation deck. The supported fallback is therefore a read-only
evidence walkthrough:

1. Use the public site and authenticated pages that remain available; do not
   retry state-changing actions.
2. Open `LOAN_ORIGINATION_V1.md` and narrate the application → review →
   authorization → receipt-confirmed activation state machine.
3. Open `ARC_TESTNET_PILOT_REPORT.md` for the recorded offer, loan, repayment,
   and receipt evidence.
4. Open `CONTROLLED_PILOT_READINESS.md#submission-evidence-index` for frozen
   commands and outcomes.
5. Show local seed data only if clearly labelled illustrative and not live Arc
   evidence.

If the failure is a service outage, record the timestamp and safe symptom, then
continue with the evidence walkthrough. Do not expose logs or attempt a target
restore during the presentation.

## Presenter close

End with the exact decision: technical GO only for the existing two-user,
test-fund-only Arc Testnet validation pilot; NO-GO for external/public lending
and production financial operations. Point to the unresolved signer custody,
target recovery, Circle console, independent security, legal, and privacy gates
in `CONTROLLED_PILOT_READINESS.md`.
