# Loans

Owns loan creation and the loan lifecycle. Employees can now select an eligible
same-organization lending offer, review deterministic terms, and confirm a
loan that reserves pledged offer capital without moving money. Each new loan
snapshots principal, term interest, duration, due date, participants, currency,
and source offer.

Employer queries are scoped using the organization from the authenticated
actor. Financial calculations use integer minor units; the offer rate applies
once to the complete loan term and is not an annualized APR. Loan creation is a
single PostgreSQL transaction with a conditional liquidity decrement, loan
snapshot, exhausted-status update, and audit event. A client request UUID makes
retries idempotent. Quote requests are informational and never reserve capital.

Borrowers can view their own loan details and record partial or full
repayments. Completed repayment records are the source of truth for totals.
Each repayment is idempotent and runs in one transaction that serializes access
to the loan, rejects overpayment, records the repayment, reduces outstanding
principal after satisfying the agreed fee, updates the lifecycle status, and
appends audit events. An explicit employer-admin lifecycle operation marks
past-due active loans as overdue. No balance transfer, payroll deduction,
penalty, Circle, USDC, blockchain, or external settlement is implemented.
