# Internal ledger

The ledger is the source of truth for simulated USDC. Employee balances are
derived from completed entries (`credits - debits`); there is no mutable wallet
balance.

Every posting is created through `postLedgerTransaction`, which validates equal
debits and credits per asset before changing the transaction from `PENDING` to
`COMPLETED`. Loan disbursements debit the lender and credit the borrower.
Repayments debit the borrower and credit the lender. Development deposits debit
a hidden organization platform account and credit the employee wallet.

Outgoing operations lock all involved account rows in deterministic order and
check the source balance inside the same PostgreSQL transaction as the loan or
repayment, audit event, and ledger posting. Completed postings and entries are
protected from update or deletion by database triggers; corrections should be
represented by future reversal postings.
