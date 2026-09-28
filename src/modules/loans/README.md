# Loans

Owns loan creation and the loan lifecycle. Employees can now select an eligible
same-organization lending offer, review deterministic terms, and confirm a
loan backed by internal mock balances. Each new loan snapshots principal, fee,
fee rate, duration, due date, participants, currency, and source offer.

Employer queries are scoped using the organization from the authenticated
actor. Financial calculations use integer minor units. Loan creation is a
single PostgreSQL transaction that updates balances and offer liquidity and
creates the ledger and audit records. A client request UUID makes retries
idempotent.

Borrowers can view their own loan details and make partial or full repayments
from uncommitted internal mock balance. Each repayment is idempotent and runs
in one transaction that writes the repayment, transfers both balances, reduces
outstanding principal after satisfying the agreed fee, adds balanced ledger
entries, updates loan status, and appends audit events. Payroll deductions,
penalties, and external settlement are not implemented.
